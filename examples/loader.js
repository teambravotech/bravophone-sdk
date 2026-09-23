/**
 * loader.js — carrega o BCVoz do CDN por JavaScript.
 *
 * Use quando não der para escrever uma <script> no HTML: SPA, Tag Manager,
 * ou uma página cujo <head> você não controla.
 *
 * Cole este arquivo inteiro, ou copie a função carregarBCVoz().
 */

/**
 * Injeta o SDK e resolve quando ele estiver pronto para uso.
 *
 * @param {object} [opts]
 * @param {string} [opts.versao='0.7']  Faixa ou versão exata no CDN.
 * @param {number} [opts.timeout=15000] Desiste depois deste tempo, em ms.
 * @returns {Promise<object>} a API global `BCVoz`
 */
function carregarBCVoz(opts = {}) {
  const versao = opts.versao || '0.7'
  const timeout = opts.timeout || 15000
  const url = `https://cdn.jsdelivr.net/npm/@bcvoz/webphone@${versao}`

  // Já disponível (outra chamada, ou uma <script> no HTML): não recarrega.
  if (window.BCVoz) return Promise.resolve(window.BCVoz)

  // Já em andamento: devolve a mesma promessa, para que duas chamadas
  // simultâneas não injetem dois scripts.
  if (window.__bcvozCarregando) return window.__bcvozCarregando

  window.__bcvozCarregando = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true

    const desistir = setTimeout(() => {
      script.remove()
      window.__bcvozCarregando = null
      reject(new Error(`BCVoz: o CDN não respondeu em ${timeout} ms`))
    }, timeout)

    script.onload = () => {
      clearTimeout(desistir)
      if (!window.BCVoz) {
        // Carregou algo que não é o SDK — CDN servindo página de erro, ou
        // um proxy corporativo no meio do caminho.
        window.__bcvozCarregando = null
        return reject(new Error('BCVoz: o script carregou mas a API não apareceu'))
      }
      resolve(window.BCVoz)
    }

    script.onerror = () => {
      clearTimeout(desistir)
      script.remove()
      window.__bcvozCarregando = null
      // Causas reais: rede, bloqueador de conteúdo, ou o CSP da página não
      // admitir cdn.jsdelivr.net em script-src.
      reject(new Error('BCVoz: falha ao carregar do CDN (rede, bloqueador ou CSP)'))
    }

    document.head.appendChild(script)
  })

  return window.__bcvozCarregando
}

// ---------------------------------------------------------------------
// Uso
// ---------------------------------------------------------------------

carregarBCVoz()
  .then((BCVoz) => {
    BCVoz.init({
      token: 'TOKEN_DO_USUARIO_LOGADO',   // emitido pelo seu backend
      mode: 'srcdoc',                     // roda na origem da sua página
      open: false,                        // começa recolhido na aba lateral
    })

    // A partir daqui a API está disponível em qualquer lugar do seu código,
    // como window.BCVoz.
    BCVoz.on('call:ended', ({ number }) => {
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
//   await carregarBCVoz()
//   BCVoz.call('11987654321', { name: 'Ana', crm: 'Acme' })
