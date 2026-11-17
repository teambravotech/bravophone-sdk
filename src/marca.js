// White-label: a marca do integrador no lugar da nossa.
//
// DOIS LUGARES QUE NÃO SE ENXERGAM. A moldura (aba de abertura, barra de
// título, borda) vive no Shadow DOM, FORA do iframe. O logotipo da tela de
// login vive DENTRO dele, alcançável só pelo HTML que o `srcdoc.js` monta. São
// dois mecanismos — folha de estilo no shadow, CSS no documento do srcdoc — e
// uma marca só. É aqui que ela é interpretada uma vez, para as duas pontas não
// divergirem.
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
// DOIS LOGOTIPOS, NÃO UM. Na barra de título cabem 16px de altura, onde um
// logotipo por extenso vira um borrão; na tela de login há espaço para a marca
// inteira. São arquivos diferentes do mesmo manual de marca — o símbolo e o
// logotipo — e por isso entram por chaves diferentes: `titleLogo` e `logo`. Um
// não herda do outro de propósito (ver `parDeLogos`).
//
// POR QUE VALIDAR O ESQUEMA DA URL. O valor entra num `url()` de CSS e num
// `href` dentro do documento do webphone. O integrador já manda na página, e
// portanto isto não é barreira de segurança: é cerca para engano, do tipo que
// transforma um erro de digitação em link quebrado em vez de surpresa.
//
// Tudo aqui é função pura: entra o objeto `branding` do init, sai texto CSS ou
// dado normalizado. Sem DOM e sem efeito colateral — é o que deixa a marca
// testável em node (scripts/smoke-marca.mjs), sem browser.

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
 * Altura pedida para um logotipo, em px. Fora de faixa é aparado, não
 * recusado: quem pede 200 quer "grande", e o maior que cabe é mais útil que
 * ignorar o pedido em silêncio.
 */
function alturaDe(valor, maximo) {
  const n = Number(valor)
  if (!Number.isFinite(n) || n <= 0) return null
  return Math.min(maximo, Math.max(8, Math.round(n)))
}

// ---------------------------------------------------------------------------
// Cor
// ---------------------------------------------------------------------------

/**
 * Só hexadecimal, de propósito.
 *
 * Os tons derivados (hover, realce, foco, sombra, barra) são calculados aqui,
 * em JavaScript, e isso exige os canais RGB. Normalizar `rebeccapurple` ou
 * `hsl(250 80% 60%)` pediria o motor de cor do browser — um elemento no
 * documento e `getComputedStyle` — o que tornaria estas funções impuras e
 * dependentes de DOM, justamente o que o arquivo evita. Hex é o formato em que
 * manual de marca vem escrito, então a restrição não aperta ninguém.
 */
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** @returns {[number,number,number]|null} canais 0–255, ou null se não for hex. */
export function lerHex(cor) {
  if (typeof cor !== 'string') return null
  const m = cor.trim().match(HEX)
  if (!m) return null
  const h = m[1].length === 3 ? m[1].replace(/./g, (c) => c + c) : m[1]
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

const limite = (n) => Math.max(0, Math.min(255, Math.round(n)))
const hexDe = (rgb) => '#' + rgb.map((n) => limite(n).toString(16).padStart(2, '0')).join('')
/** Triplo "r,g,b" para entrar em rgba(var(--token), .42). */
const triplo = (rgb) => rgb.map(limite).join(',')

/** Mistura com preto: t=0.12 devolve 12% mais escuro. */
export const escurecer = (rgb, t) => rgb.map((n) => n * (1 - t))
/** Mistura com branco. */
export const clarear = (rgb, t) => rgb.map((n) => n + (255 - n) * t)

/** Luminância relativa (WCAG 2.x). Serve para decidir texto claro ou escuro. */
export function luminancia(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Razão de contraste entre dois hex. 3:1 é o mínimo para ícone; 4.5:1 para texto. */
export function contraste(a, b) {
  const la = luminancia(lerHex(a)), lb = luminancia(lerHex(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/**
 * Paletas sugeridas.
 *
 * Não são enfeite: escolher cor de marca dá errado de dois jeitos previsíveis —
 * uma aba onde o ícone branco não se lê, e uma barra de título que briga com o
 * tom da aba. Cada paleta daqui já passou pelas duas provas em
 * `scripts/smoke-marca.mjs`: contraste do ícone sobre a aba (>= 3:1, o mínimo
 * do WCAG para elemento gráfico) e do texto sobre a barra (>= 4.5:1).
 *
 * `surface` é o fundo da MOLDURA no tema escuro — a barra de título e a borda
 * da janela, não o interior do webphone, que tem tema próprio. Um pouco do tom
 * da marca entra aí para a moldura não parecer peça de outro conjunto.
 */
export const PALETAS = {
  violet: {
    label: 'Violeta (BCVOZ)',
    color: '#6c5ce7', colorHover: '#5b4bd6',
    surface: '#1e1e2d', surfaceLight: '#ffffff',
  },
  indigo: {
    label: 'Índigo',
    color: '#4f46e5', colorHover: '#4338ca',
    surface: '#1b1d2e', surfaceLight: '#ffffff',
  },
  blue: {
    label: 'Azul',
    color: '#2563eb', colorHover: '#1d4ed8',
    surface: '#161d2e', surfaceLight: '#ffffff',
  },
  teal: {
    label: 'Oceano',
    color: '#0f766e', colorHover: '#115e59',
    surface: '#122524', surfaceLight: '#ffffff',
  },
  emerald: {
    label: 'Esmeralda',
    color: '#047857', colorHover: '#065f46',
    surface: '#122621', surfaceLight: '#ffffff',
  },
  amber: {
    label: 'Âmbar',
    color: '#b45309', colorHover: '#92400e',
    surface: '#26200f', surfaceLight: '#ffffff',
  },
  crimson: {
    label: 'Carmim',
    color: '#be123c', colorHover: '#9f1239',
    surface: '#2a1118', surfaceLight: '#ffffff',
  },
  slate: {
    label: 'Grafite',
    color: '#475569', colorHover: '#334155',
    surface: '#1a1f28', surfaceLight: '#ffffff',
  },
}

const tem = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k)

/** A cor da marca resolvida: a paleta escolhida, com o que o integrador trocou por cima. */
function coresDe(marca) {
  const base = (typeof marca.palette === 'string' && PALETAS[marca.palette]) || {}
  if (typeof marca.palette === 'string' && !PALETAS[marca.palette]) {
    console.warn('[BCVoz] branding.palette desconhecida: ' + JSON.stringify(marca.palette) +
      ' — use uma de ' + Object.keys(PALETAS).join(', ') + '.')
  }
  const cores = {}
  for (const chave of ['color', 'colorHover', 'surface', 'surfaceLight']) {
    const pedido = tem(marca, chave) ? marca[chave] : undefined
    if (pedido !== undefined && !lerHex(pedido)) {
      console.warn(`[BCVoz] branding.${chave} ignorado: ` + JSON.stringify(pedido) +
        ' — use hexadecimal, como "#0f766e".')
    }
    const valor = (pedido !== undefined && lerHex(pedido)) ? String(pedido).trim() : base[chave]
    if (valor) cores[chave] = valor
  }
  return cores
}

/**
 * Tokens de uma superfície da moldura.
 *
 * O que muda com a cor escolhida é o fundo; o que muda com a LUMINÂNCIA dela é
 * todo o resto — texto, borda, realce. É por isso que não há "tema claro" e
 * "tema escuro" aqui, e sim uma conta: quem pedir uma barra clara no tema
 * escuro recebe texto escuro nela, e continua legível. Escolher a cor errada
 * fica feio, nunca ilegível.
 */
function tokensDaSuperficie(hex) {
  const rgb = lerHex(hex)
  if (!rgb) return null
  const escura = luminancia(rgb) < 0.3
  return escura ? {
    '--bpw-bg': hexDe(rgb),
    '--bpw-header-bg': hexDe(escurecer(rgb, 0.3)),
    '--bpw-overlay-bg': `rgba(${triplo(escurecer(rgb, 0.55))},.72)`,
    '--bpw-texto': '#e6e6f0',
    '--bpw-texto-forte': '#fff',
    '--bpw-texto-dim': '#9ca3af',
    '--bpw-texto-fraco': '#cbd5e1',
    '--bpw-borda': 'rgba(255,255,255,.06)',
    '--bpw-sombra': 'rgba(0,0,0,.45)',
    '--bpw-realce': 'rgba(255,255,255,.08)',
    '--bpw-alca': 'rgba(255,255,255,.3)',
  } : {
    '--bpw-bg': hexDe(rgb),
    '--bpw-header-bg': hexDe(escurecer(rgb, 0.05)),
    '--bpw-overlay-bg': `rgba(${triplo(clarear(rgb, 0.4))},.88)`,
    '--bpw-texto': '#161a24',
    '--bpw-texto-forte': '#161a24',
    '--bpw-texto-dim': '#5a6379',
    '--bpw-texto-fraco': '#5a6379',
    '--bpw-borda': 'rgba(16,24,40,.12)',
    '--bpw-sombra': 'rgba(16,24,40,.18)',
    '--bpw-realce': 'rgba(15,23,42,.07)',
    '--bpw-alca': 'rgba(15,23,42,.28)',
  }
}

/**
 * Tokens da marca, separados por bloco de tema.
 *
 * `comuns` vale nos dois temas: cor é identidade, e identidade não muda quando
 * o usuário troca de tema. `claro` só existe para a superfície, que é a única
 * coisa aqui que o tema tem o direito de trocar.
 *
 * @param {object|null} marca  já normalizada por `normalizarMarca`
 * @returns {{comuns: Record<string,string>, claro: Record<string,string>}}
 */
export function tokensDaMarca(marca) {
  const comuns = {}
  const claro = {}
  if (!marca) return { comuns, claro }

  const cores = marca.cores || {}
  const base = lerHex(cores.color)
  const hover = lerHex(cores.colorHover)
  if (base) {
    comuns['--bpw-marca'] = hexDe(base)
    comuns['--bpw-marca-hover'] = hexDe(hover || escurecer(base, 0.12))
    comuns['--bpw-marca-clara'] = hexDe(clarear(base, 0.22))
    comuns['--bpw-marca-foco'] = hexDe(clarear(base, 0.7))
    comuns['--bpw-marca-sombra'] = triplo(escurecer(base, 0.3))
    comuns['--bpw-marca-halo'] = triplo(clarear(base, 0.11))
  } else if (hover) {
    // Sem cor base, mas com hover: respeita o que veio em vez de descartar.
    comuns['--bpw-marca-hover'] = hexDe(hover)
  }

  if (marca.barraAltura) comuns['--bpw-logo-altura'] = `${marca.barraAltura}px`

  Object.assign(comuns, tokensDaSuperficie(cores.surface) || {})
  Object.assign(claro, tokensDaSuperficie(cores.surfaceLight) || {})
  return { comuns, claro }
}

const bloco = (seletor, tokens) => {
  const linhas = Object.entries(tokens).map(([k, v]) => `  ${k}: ${v};`)
  return linhas.length ? `${seletor} {\n${linhas.join('\n')}\n}` : ''
}

/**
 * CSS da marca para a MOLDURA, acrescentado ao Shadow DOM depois do WIDGET_CSS.
 *
 * Por que folha de estilo e não `style` inline no host: a superfície tem uma
 * versão por tema, e inline não sabe de tema — venceria os dois blocos de uma
 * vez e deixaria o tema claro com o fundo do escuro. Numa folha que vem
 * DEPOIS, cada bloco continua sob o seu seletor e o desempate é por ordem.
 *
 * Vale nos dois modos: a moldura é do SDK, não do documento do webphone.
 *
 * @returns {string} '' quando não há marca a aplicar.
 */
export function cssDaMarcaNaMoldura(marca) {
  const { comuns, claro } = tokensDaMarca(marca)
  return [
    bloco(':host', comuns),
    bloco(':host([data-bp-tema="claro"])', claro),
  ].filter(Boolean).join('\n')
}

// ---------------------------------------------------------------------------
// Logotipos
// ---------------------------------------------------------------------------

/**
 * Resolve um par de logotipos (versão para tema escuro e para tema claro).
 *
 * A herança é por PAR, não por campo: quem informa `titleLogo` sem
 * `titleLogoLight` recebe o próprio `titleLogo` nos dois temas — nunca o
 * `logoLight`, que é do logotipo inteiro e apareceria numa barra de 16px, só
 * no tema claro. Herdar campo a campo criaria exatamente esse defeito, visível
 * para metade dos usuários.
 *
 * @returns {{escuro: string, claro: string}|false|null}
 *   as duas URLs; `false` quando o integrador pediu para apagar; `null` quando
 *   ele não disse nada (fica a marca de fábrica).
 */
function parDeLogos(marca, chave, chaveClara) {
  if (!tem(marca, chave)) return null
  const escuro = url(marca[chave], chave, LOGO_OK)
  if (escuro === false) return false
  // URL recusada não vira "sem logotipo": apagar a marca por causa de um erro
  // de digitação seria pior do que manter a de fábrica. O aviso já saiu.
  if (!escuro) return null
  const claro = url(marca[chaveClara], chaveClara, LOGO_OK)
  return { escuro, claro: (typeof claro === 'string' && claro) || escuro }
}

/**
 * O logotipo da BARRA DE TÍTULO, já normalizado.
 *
 * @returns {{escuro: string, claro: string}|null}
 */
export function logoDaBarra(marca) {
  return (marca && marca.barra) || null
}

/**
 * @param {object|undefined} marca  o que veio em `init({ branding })`
 * @returns {object|null}
 *   null quando não há nada a fazer — aí nem o srcdoc nem a moldura carregam
 *   peso nenhum.
 */
export function normalizarMarca(marca) {
  if (!marca || typeof marca !== 'object') return null

  const nome = nomeDe(marca.name)
  const logo = url(marca.logo, 'logo', LOGO_OK)
  const logoClaro = url(marca.logoLight, 'logoLight', LOGO_OK)
  const logoAltura = alturaDe(marca.logoHeight, 72)

  // A barra tem 36px de altura; acima de 24 o logotipo encosta nas bordas.
  const barra = parDeLogos(marca, 'titleLogo', 'titleLogoLight')
  const barraAltura = alturaDe(marca.titleLogoHeight, 24)

  const links = {}
  // `links: false` é o atalho para "tire os três".
  const pedido = marca.links === false
    ? { signup: false, support: false, portal: false }
    : (marca.links || {})

  for (const chave of Object.keys(LINKS)) {
    const v = url(pedido[chave], `links.${chave}`, ESQUEMA_OK)
    if (v !== null) links[chave] = v
  }

  const cores = coresDe(marca)

  if (nome === null && logo === null && barra === null && !Object.keys(links).length &&
      !Object.keys(cores).length && !barraAltura && !logoAltura) return null

  return {
    nome, logo, logoClaro: typeof logoClaro === 'string' ? logoClaro : null, logoAltura,
    barra: barra || null, barraAltura, links, cores,
  }
}

/**
 * O que da marca só funciona DENTRO do documento do webphone — e portanto só
 * no `mode: 'srcdoc'`. A moldura (cores, logotipo da barra) funciona nos dois,
 * e por isso não entra nesta conta: avisar sobre ela seria avisar errado.
 */
export function soNoSrcdoc(marca) {
  if (!marca) return []
  const campos = []
  if (marca.nome !== null) campos.push('name')
  if (marca.logo !== null) campos.push('logo')
  if (Object.keys(marca.links).length) campos.push('links')
  return campos
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
  const altura = marca.logoAltura || 44

  // Três caminhos para o mesmo espaço: imagem, nome escrito, ou nada. Pedir
  // um nome (ou `name: ''`) já implica tirar o logotipo — ninguém quer os
  // dois empilhados.
  if (marca.logo) {
    // `content` troca a imagem no lugar, sem tocar no layout em volta.
    regras.push('img.bcvoz-logo{content:url("' + cssSeguro(marca.logo) + '")!important;' +
      'max-height:' + altura + 'px;width:auto;object-fit:contain}')
    // O tema claro pede a outra arte. O atributo do tema mora no :root do
    // documento do webphone, e o seletor com ele vence o de cima por
    // especificidade — a ordem aqui não precisa ser confiada.
    if (marca.logoClaro) {
      regras.push(':root[data-bp-tema="claro"] img.bcvoz-logo{' +
        'content:url("' + cssSeguro(marca.logoClaro) + '")!important}')
    }
  } else if (marca.logo === false || marca.nome !== null) {
    regras.push('img.bcvoz-logo{display:none!important}')
  } else if (marca.logoAltura) {
    // Altura sem troca de arte: é o nosso logotipo, no tamanho que o
    // integrador pediu.
    regras.push('img.bcvoz-logo{max-height:' + altura + 'px;width:auto;object-fit:contain}')
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
