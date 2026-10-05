// Mantém a sessão viva enquanto o webphone estiver aberto.
//
// O vxToken vence (`expiresIn`, tipicamente 3600 s) e nada o renovava: depois
// desse tempo o bundle julgava a sessão vencida e o login caía, no meio do
// expediente. O SDK não tem como emitir um token — quem tem é o backend do
// integrador, o mesmo que entregou a sessão no init. Por isso a renovação é
// uma função dele (`refreshSession`), que o SDK chama ANTES do vencimento.
//
// Dois gatilhos:
//   · o prazo: com folga de 20%, limitada a 5 min (token de 1 h renova aos
//     55 min) — ou a folga que o integrador pedir em refreshMargin;
//   · o 401 da API: o expiresIn conta a partir do login, não do init, então um
//     integrador que guardou a sessão por meia hora entrega um prazo otimista.
//     O 401 é a prova de que venceu, e renova na hora.
//
// Sem `refreshSession`, o SDK avisa (`session:expiring`) para o integrador
// chamar setAuth() por conta própria — que é como era, só que agora sabendo.

const FOLGA_MAX = 5 * 60 * 1000
/** Entre tentativas que falharam, enquanto ainda houver prazo. */
const ESPERA_RETRY = 30 * 1000
/** Abaixo disto uma falha persistente vira martelada no backend. */
const ESPERA_MIN = 5 * 1000

/** Segundos vindos do integrador; null quando não é um número positivo. */
function segundos(v) {
  const n = Number(v)
  return v != null && n > 0 ? n * 1000 : null
}

/**
 * Em quantos ms renovar uma sessão com este expiresIn (s); null se não há prazo.
 *
 * @param {number} expiresIn  validade do token, em segundos
 * @param {number} [margem]   refreshMargin: segundos antes do vencimento. Sem
 *   ela, 20% do prazo, no máximo 5 min.
 */
export function prazoDeRenovacao(expiresIn, margem) {
  const total = Number(expiresIn) * 1000
  if (!(total > 0)) return null
  const pedida = segundos(margem)
  // Folga pedida vale até metade do prazo: maior que isso, cada token novo
  // já nasceria "para vencer" e o SDK renovaria sem parar.
  const folga = pedida !== null
    ? Math.min(pedida, total * 0.5)
    : Math.min(FOLGA_MAX, total * 0.2)
  return Math.max(1000, Math.round(total - folga))
}

/** Intervalo entre tentativas (refreshRetry, em s), com piso de 5 s. */
export function esperaEntreTentativas(retry) {
  const pedida = segundos(retry)
  return pedida === null ? ESPERA_RETRY : Math.max(ESPERA_MIN, pedida)
}

/**
 * @param {object} o
 * @param {() => Promise<object>} [o.renovar]  refreshSession do integrador
 * @param {(sessao: object) => Promise<any>} o.aplicar  aplica a sessão nova
 * @param {(evento: string, payload: object) => void} o.emitir
 * @param {object} [o.relogio]  injetável nos testes
 */
export function manterSessao({ renovar, aplicar, emitir, relogio, margem, retry }) {
  const r = relogio || { setTimeout, clearTimeout, now: () => Date.now() }
  const espera = esperaEntreTentativas(retry)
  let timer = null
  let venceEm = null
  let expirada = false
  let emAndamento = null
  let parado = false

  function limpar() {
    r.clearTimeout(timer)
    timer = null
  }

  /** Recomeça a contagem a partir de uma sessão recém-aplicada. */
  function programar(sessao) {
    limpar()
    venceEm = null
    expirada = false
    if (parado || !sessao) return
    const ms = prazoDeRenovacao(sessao.expiresIn, margem)
    // Sem validade conhecida não há prazo a vigiar: só o 401 dispara.
    if (ms === null) return
    venceEm = r.now() + Number(sessao.expiresIn) * 1000
    timer = r.setTimeout(() => renovarAgora('prazo'), ms)
  }

  function avisarExpirada(motivo) {
    if (expirada) return
    expirada = true
    emitir('session:expired', { reason: motivo })
  }

  /**
   * @param {'prazo'|'401'} gatilho
   * @returns {Promise<boolean>} se renovou
   */
  function renovarAgora(gatilho) {
    if (parado) return Promise.resolve(false)
    limpar()

    if (typeof renovar !== 'function') {
      if (gatilho === '401') avisarExpirada('token recusado pela API (401)')
      else emitir('session:expiring', { expiresAt: venceEm })
      return Promise.resolve(false)
    }

    // Prazo e 401 podem chegar juntos: uma renovação só.
    if (emAndamento) return emAndamento

    emAndamento = Promise.resolve()
      .then(() => renovar())
      .then((nova) => {
        if (parado) return false
        if (!nova || !nova.vxToken) {
          throw new Error('refreshSession não devolveu uma sessão com vxToken')
        }
        return Promise.resolve(aplicar(nova)).then(() => {
          if (parado) return false
          programar(nova)
          emitir('session:renewed', { expiresIn: nova.expiresIn ?? null })
          return true
        })
      })
      .catch((err) => {
        if (parado) return false
        const motivo = (err && err.message) || String(err)
        // Ainda há prazo: tenta de novo. Uma falha de rede passageira não
        // pode virar logout.
        if (gatilho === 'prazo' && venceEm !== null && venceEm - r.now() > espera) {
          emitir('error', { message: 'falha ao renovar a sessão: ' + motivo })
          timer = r.setTimeout(() => renovarAgora('prazo'), espera)
        } else {
          avisarExpirada(motivo)
        }
        return false
      })
      .finally(() => { emAndamento = null })

    return emAndamento
  }

  return {
    programar,
    renovarAgora,
    parar() { parado = true; limpar() },
  }
}
