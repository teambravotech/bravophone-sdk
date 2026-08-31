// Acompanha o ramal SIP do usuário depois do login.
//
// O ramal pode ser atribuído ou trocado no painel sem a pessoa refazer login,
// e o webphone não fica sabendo. Este módulo consulta o
// `GET /api/pabx/extension` de tempos em tempos e avisa quando o estado muda.
//
// O custo é baixo por desenho: o servidor manda `ETag`, então o caso comum é
// um 304 sem corpo. Sem o ETag, seria uma resposta inteira por minuto e por
// usuário logado.

const INTERVALO_PADRAO = 60000
/** O servidor manda `Cache-Control: max-age=30`; abaixo disso é desperdício. */
const INTERVALO_MINIMO = 30000

/**
 * @param {object} o
 * @param {string} o.apiBase      ex.: 'https://pabx.teambravotech.com'
 * @param {string} o.token        vxToken/pabxToken da sessão
 * @param {number} [o.intervalo]  ms entre consultas
 * @param {(status: object) => void} o.onMudanca  chamado quando o estado muda
 * @param {(buscando: boolean) => void} [o.onConsulta] início/fim de cada consulta
 * @param {(erro: Error) => void} [o.onErroSessao] chamado no 401
 */
export function acompanharRamal({ apiBase, token, intervalo, onMudanca, onConsulta, onErroSessao }) {
  const url = `${String(apiBase).replace(/\/+$/, '')}/api/pabx/extension`
  const espera = Math.max(INTERVALO_MINIMO, intervalo || INTERVALO_PADRAO)

  let etag = null
  let ultimoReason = null
  let timer = null
  let parado = false

  async function consultar() {
    onConsulta?.(true)
    try {
      const resp = await fetch(url, {
        headers: {
          // X-Pabx-Token, e não Authorization: o preflight da API responde
          // `Access-Control-Allow-Headers: Content-Type, X-Pabx-Token,
          // X-Vx-Token, X-Proxy-Key`. Com Authorization o navegador bloqueia
          // antes de enviar, mesmo o servidor aceitando o header.
          'X-Pabx-Token': token,
          // Devolve o ETag exatamente como veio: é assim que o 304 acontece.
          ...(etag ? { 'If-None-Match': etag } : {}),
        },
      })

      // Nada mudou desde a última consulta — o caminho comum.
      if (resp.status === 304) return

      if (resp.status === 401) {
        parar()
        onErroSessao?.(new Error('sessão expirada'))
        return
      }

      if (!resp.ok) return   // 5xx e afins: tenta de novo no próximo ciclo

      etag = resp.headers.get('ETag') || etag
      const dados = await resp.json()
      const status = dados.extensionStatus || dados

      // Só avisa em transição: sem isto, cada consulta reaplicaria o mesmo
      // estado e o aviso piscaria na tela.
      if (status.reason !== ultimoReason) {
        ultimoReason = status.reason
        onMudanca?.(status)
      }
    } catch {
      // Rede caiu, CORS, aba suspensa: silêncio e nova tentativa depois. Um
      // erro aqui não pode virar ruído no console do integrador.
    } finally {
      // Um piscar curto: o giro serve para dizer "estou verificando", não
      // para virar animação permanente na tela.
      setTimeout(() => onConsulta?.(false), 420)
    }
  }

  function agendar() {
    if (parado) return
    timer = setTimeout(async () => { await consultar(); agendar() }, espera)
  }

  function parar() {
    parado = true
    clearTimeout(timer)
    document.removeEventListener('visibilitychange', aoVoltar)
  }

  // Aba em segundo plano não precisa consultar; ao voltar, verifica na hora.
  // É quando o usuário tem mais chance de ter mudado algo no painel.
  function aoVoltar() {
    if (document.visibilityState === 'visible') consultar()
  }
  document.addEventListener('visibilitychange', aoVoltar)

  consultar()
  agendar()

  return { parar, consultarAgora: consultar }
}
