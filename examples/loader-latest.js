/**
 * loader-latest.js — mantém o cliente sempre na última versão publicada,
 * sem sofrer com cache obsoleto.
 *
 * ─── POR QUE NÃO BASTA USAR A URL SEM VERSÃO ───────────────────────────────
 *
 * O caminho óbvio seria:
 *
 *     <script src="https://cdn.jsdelivr.net/npm/@bravophone/webphone"></script>
 *
 * É a PIOR opção para "sempre a última". Os headers do CDN explicam:
 *
 *     sem versão / @0.2   →  max-age=604800   (7 dias)
 *     @0.2.1 exata        →  immutable        (eterno)
 *
 * A URL sem versão é entregue com sete dias de cache NO NAVEGADOR do usuário.
 * Publicar uma correção não o alcança: o purge do jsDelivr limpa os servidores
 * de borda, mas não o cache que já está na máquina dele. Ele pode ficar uma
 * semana com a versão antiga.
 *
 * ─── COMO ESTE LOADER RESOLVE ──────────────────────────────────────────────
 *
 *   1. pergunta ao CDN qual é a versão atual — resposta com 5 min de cache;
 *   2. carrega o bundle daquela versão EXATA — URL imutável, cache eterno.
 *
 * O resultado junta as duas pontas: uma publicação chega em até cinco minutos,
 * e o arquivo pesado vem de um cache que nunca precisa ser revalidado.
 *
 * O custo é uma requisição de metadados (~1 kB) antes do bundle. Ela responde
 * do cache na maior parte das vezes.
 */

const PACOTE = '@bravophone/webphone'
const META = `https://data.jsdelivr.com/v1/packages/npm/${PACOTE}/resolved`
const ARQUIVO = 'dist/bravophone.umd.js'

/**
 * @param {object} [opts]
 * @param {number} [opts.timeout=12000] Tempo total, em ms.
 * @returns {Promise<object>} a API `Bravophone`, já carregada
 */
export function carregarUltimaVersao(opts = {}) {
  const timeout = opts.timeout || 12000

  if (window.Bravophone) return Promise.resolve(window.Bravophone)
  if (window.__bpCarregando) return window.__bpCarregando

  window.__bpCarregando = (async () => {
    const versao = await resolverVersao(timeout)
    const url = versao
      ? `https://cdn.jsdelivr.net/npm/${PACOTE}@${versao}/${ARQUIVO}`
      // Sem a versão resolvida, a URL sem versão ainda funciona: pode estar
      // até 7 dias atrás, mas é melhor que um webphone que não carrega.
      : `https://cdn.jsdelivr.net/npm/${PACOTE}`

    await injetar(url, timeout)

    if (!window.Bravophone) {
      throw new Error('Bravophone: o script carregou mas a API não apareceu')
    }
    return window.Bravophone
  })()

  // Uma falha não pode deixar a promessa cacheada: a próxima chamada deve
  // poder tentar de novo.
  window.__bpCarregando.catch(() => { window.__bpCarregando = null })
  return window.__bpCarregando
}

/** Pergunta ao CDN a versão publicada. Devolve null se não der. */
async function resolverVersao(timeout) {
  try {
    const controle = new AbortController()
    const t = setTimeout(() => controle.abort(), Math.min(timeout, 4000))
    const resp = await fetch(META, { signal: controle.signal })
    clearTimeout(t)
    if (!resp.ok) return null
    const dados = await resp.json()
    // Confere o formato: um proxy corporativo pode devolver HTML com 200.
    return /^\d+\.\d+\.\d+/.test(dados.version || '') ? dados.version : null
  } catch {
    return null
  }
}

function injetar(url, timeout) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = url
    s.async = true
    const t = setTimeout(() => {
      s.remove()
      reject(new Error(`Bravophone: o CDN não respondeu em ${timeout} ms`))
    }, timeout)
    s.onload = () => { clearTimeout(t); resolve() }
    s.onerror = () => {
      clearTimeout(t); s.remove()
      reject(new Error('Bravophone: falha ao carregar (rede, bloqueador ou CSP)'))
    }
    document.head.appendChild(s)
  })
}

// ---------------------------------------------------------------------
// Uso
// ---------------------------------------------------------------------

carregarUltimaVersao()
  .then((Bravophone) => {
    console.info('Bravophone', Bravophone.version)
    Bravophone.init({
      token: 'TOKEN_DO_USUARIO_LOGADO',
      mode: 'srcdoc',
      open: false,
    })
  })
  .catch((erro) => {
    // Sem isto, o botão de ligar simplesmente não faz nada.
    console.error(erro.message)
  })
