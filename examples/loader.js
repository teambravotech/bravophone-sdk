/**
 * loader.js — carrega o Bravophone do CDN por JavaScript.
 *
 * Use quando não der para escrever uma <script> no HTML: SPA, Tag Manager,
 * ou uma página cujo <head> você não controla.
 *
 * Cole este arquivo inteiro, ou copie a função carregarBravophone().
 */

/**
 * Injeta o SDK e resolve quando ele estiver pronto para uso.
 *
 * @param {object} [opts]
 * @param {string} [opts.versao='0.2']  Faixa ou versão exata no CDN.
 * @param {number} [opts.timeout=15000] Desiste depois deste tempo, em ms.
 * @returns {Promise<object>} a API global `Bravophone`
 */
function carregarBravophone(opts = {}) {
  const versao = opts.versao || '0.2'
  const timeout = opts.timeout || 15000
  const url = `https://cdn.jsdelivr.net/npm/@bravophone/webphone@${versao}`

  // Já disponível (outra chamada, ou uma <script> no HTML): não recarrega.
  if (window.Bravophone) return Promise.resolve(window.Bravophone)

  // Já em andamento: devolve a mesma promessa, para que duas chamadas
  // simultâneas não injetem dois scripts.
  if (window.__bravophoneCarregando) return window.__bravophoneCarregando

  window.__bravophoneCarregando = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true

    const desistir = setTimeout(() => {
      script.remove()
      window.__bravophoneCarregando = null
      reject(new Error(`Bravophone: o CDN não respondeu em ${timeout} ms`))
    }, timeout)

    script.onload = () => {
      clearTimeout(desistir)
      if (!window.Bravophone) {
        // Carregou algo que não é o SDK — CDN servindo página de erro, ou
        // um proxy corporativo no meio do caminho.
        window.__bravophoneCarregando = null
        return reject(new Error('Bravophone: o script carregou mas a API não apareceu'))
      }
      resolve(window.Bravophone)
    }

    script.onerror = () => {
      clearTimeout(desistir)
      script.remove()
      window.__bravophoneCarregando = null
      // Causas reais: rede, bloqueador de conteúdo, ou o CSP da página não
      // admitir cdn.jsdelivr.net em script-src.
      reject(new Error('Bravophone: falha ao carregar do CDN (rede, bloqueador ou CSP)'))
    }

    document.head.appendChild(script)
  })

  return window.__bravophoneCarregando
}

// ---------------------------------------------------------------------
// Uso
// ---------------------------------------------------------------------

carregarBravophone()
  .then((Bravophone) => {
    Bravophone.init({
      token: 'TOKEN_DO_USUARIO_LOGADO',   // emitido pelo seu backend
      mode: 'srcdoc',                     // roda na origem da sua página
      open: false,                        // começa recolhido na aba lateral
    })

    // A partir daqui a API está disponível em qualquer lugar do seu código,
    // como window.Bravophone.
    Bravophone.on('call:ended', ({ number }) => {
      console.log('chamada encerrada:', number)
    })
  })
  .catch((erro) => {
    // Não deixe a falha silenciosa: sem isto, o botão de ligar simplesmente
    // não faz nada e ninguém sabe por quê.
    console.error(erro.message)
  })

// Para discar de qualquer lugar depois do carregamento:
//
//   await carregarBravophone()
//   Bravophone.call('11987654321', { name: 'Ana', crm: 'Acme' })
