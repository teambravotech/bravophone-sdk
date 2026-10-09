// White-label: a marca BCVOZ sai da tela quando o integrador pede.
//
// O QUE A TELA MOSTRA DE NOSSO. O logotipo (`img.bcvoz-logo`, uma versão por
// tema) e três links no rodapé do login: "Criar conta"
// (`pabx.teambravotech.com`), "Suporte" (um grupo de WhatsApp) e
// "Portal BCVOZ" (`bravotech.teambravotech.com`). Para quem revende o webphone
// dentro do próprio produto, isso é a marca de outra empresa na cara do
// cliente dele — e os links tiram a pessoa do app no meio do login.
//
// COMO. CSS no documento do srcdoc, que é nosso, mirando o que não é
// minificado: a classe do logotipo e o domínio de cada href. O bundle é build
// de produção e não há caminho de API até os dados do componente (os links
// moram em `data()`), então o DOM é o ponto de contato honesto.
//
// Trocar um link por outro exige mexer no atributo, e só nesse caso um
// observador entra em cena — esconder é só CSS.
//
// POR QUE VALIDAR O ESQUEMA DA URL. O valor entra num `url()` de CSS e num
// `href` dentro do documento do webphone. O integrador já manda na página, e
// portanto isto não é barreira de segurança: é cerca para engano, do tipo que
// transforma um erro de digitação em link quebrado em vez de surpresa.

/** Cada link nosso, pelo domínio — é o que não muda entre builds do bundle. */
const LINKS = {
  signup: 'pabx.teambravotech.com',
  support: 'chat.whatsapp.com',
  portal: 'bravotech.teambravotech.com',
}

const ESQUEMA_OK = /^(https?:|mailto:|tel:)/i
const LOGO_OK = /^(https?:|data:image\/)/i

/** `false` continua `false`; URL torta vira `null` com aviso. */
function url(valor, chave, aceita) {
  if (valor === false) return false
  if (valor === undefined || valor === null || valor === '') return null
  const texto = String(valor).trim()
  if (!aceita.test(texto)) {
    console.warn(`[BCVoz] branding.${chave} ignorado: ` + JSON.stringify(valor) +
      ' — use uma URL http(s)' + (aceita === LOGO_OK ? ' ou data:image/.' : ', mailto: ou tel:.'))
    return null
  }
  return texto
}

/** O nome do cliente: texto curto, uma linha. `''` quer dizer "nada". */
function nomeDe(valor) {
  if (valor === undefined) return null          // não configurado
  if (valor === false || valor === null) return ''
  const texto = String(valor).replace(/\s+/g, ' ').trim().slice(0, 40)
  return texto
}

/**
 * @param {object|undefined} marca  o que veio em `init({ branding })`
 * @returns {{nome: string|null, logo: string|false|null, links: object}|null}
 *   null quando não há nada a fazer — aí o srcdoc não carrega peso nenhum.
 */
export function normalizarMarca(marca) {
  if (!marca || typeof marca !== 'object') return null

  const nome = nomeDe(marca.name)
  const logo = url(marca.logo, 'logo', LOGO_OK)
  const links = {}
  // `links: false` é o atalho para "tire os três".
  const pedido = marca.links === false
    ? { signup: false, support: false, portal: false }
    : (marca.links || {})

  for (const chave of Object.keys(LINKS)) {
    const v = url(pedido[chave], `links.${chave}`, ESQUEMA_OK)
    if (v !== null) links[chave] = v
  }

  if (nome === null && logo === null && !Object.keys(links).length) return null
  return { nome, logo, links }
}

/**
 * O CSS que tira (ou troca) a marca. String vazia quando não há o que fazer.
 *
 * Os separadores do rodapé são irmãos dos links (`<span>·</span>`): esconder
 * um link sozinho deixaria um ponto órfão. Some com todos e abre o espaçamento
 * — dois links lado a lado com folga parecem propositais; com um ponto solto
 * entre eles, parecem defeito.
 */
export function cssDaMarca(marca) {
  if (!marca) return ''
  const regras = []

  // Três caminhos para o mesmo espaço: imagem, nome escrito, ou nada. Pedir
  // um nome (ou `name: ''`) já implica tirar o logotipo — ninguém quer os
  // dois empilhados.
  if (marca.logo) {
    // `content` troca a imagem no lugar, sem tocar no layout em volta.
    regras.push('img.bcvoz-logo{content:url("' + cssSeguro(marca.logo) + '")!important;' +
      'max-height:44px;width:auto;object-fit:contain}')
  } else if (marca.logo === false || marca.nome !== null) {
    regras.push('img.bcvoz-logo{display:none!important}')
  }

  // Imagem e nome disputam o mesmo espaço; a imagem manda. O nome não se
  // perde: ele continua valendo no título da janela e nos textos.
  if (marca.nome && !marca.logo) {
    // O texto entra no PAI do logotipo: um <img> é elemento substituído e não
    // desenha ::before/::after. `:has()` é o que permite subir um nível sem
    // JavaScript — e sem ele o espaço só fica vazio, que é o pior caso aceito.
    regras.push('.login-screen *:has(> img.bcvoz-logo)::after{' +
      'content:"' + cssSeguro(marca.nome) + '";' +
      'font:700 17px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;' +
      'letter-spacing:.01em;color:currentColor}')
  }

  const escondidos = Object.keys(LINKS).filter((k) => marca.links[k] === false)
  for (const chave of escondidos) {
    regras.push('.login-screen .footer a[href*="' + LINKS[chave] + '"]{display:none!important}')
  }
  if (escondidos.length) {
    regras.push('.login-screen .footer span{display:none!important}')
    regras.push('.login-screen .footer > div:first-child{gap:12px}')
  }
  // Sem link nenhum sobra uma linha vazia com borda em cima.
  if (escondidos.length === Object.keys(LINKS).length) {
    regras.push('.login-screen .footer > div:first-child{display:none!important}')
  }

  return regras.join('\n')
}

/**
 * Pares [domínio nosso, URL do integrador] para os links que foram trocados,
 * e não escondidos. Vazio quando ninguém trocou nada — e aí o srcdoc nem
 * instala o observador.
 */
export function trocasDeLink(marca) {
  if (!marca) return []
  return Object.keys(LINKS)
    .filter((k) => typeof marca.links[k] === 'string')
    .map((k) => [LINKS[k], marca.links[k]])
}

/**
 * O nome que substitui "BCVOZ" nos textos da interface, ou null para deixá-los
 * como estão.
 *
 * Cinco frases do `_locales` carregam a marca, e uma delas fica logo abaixo do
 * logotipo: "Acesse seu webphone BCVOZ". Trocar a imagem e deixar a frase seria
 * meio caminho — o cliente do integrador continuaria lendo o nome de outra
 * empresa. Com `name: ''` a palavra simplesmente sai.
 */
export function nomeNosTextos(marca) {
  return marca && marca.nome !== null && marca.nome !== undefined ? marca.nome : null
}

/** Fecha aspas e barras que quebrariam o `url()`. */
function cssSeguro(valor) {
  return String(valor).replace(/[\\"]/g, '\\$&').replace(/[\r\n]/g, '')
}
