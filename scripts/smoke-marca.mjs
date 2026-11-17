// White-label: a marca BCVOZ sai da tela quando o integrador pede, e a dele
// entra.
//
// POR QUE EXISTE: quem revende o webphone dentro do próprio produto não pode
// mostrar o logotipo de outra empresa, nem um "Suporte" que leva a pessoa
// para um grupo de WhatsApp que não é o dele, no meio do login.
//
// A marca atravessa quatro fronteiras, e cada uma falha calada:
//
//   1. Os SELETORES são o contrato com um bundle minificado: a classe
//      `bcvoz-logo`, a classe `footer` e o domínio de cada link. Se a extensão
//      mudar qualquer um deles, a marca volta à tela sem que ninguém perceba —
//      e é isso que as checagens contra o host de verdade pegam.
//
//   2. A cor vira folha de estilo acrescentada ao Shadow DOM. Um token com
//      nome errado não quebra nada: o CSS cai no valor do `:host` e a aba
//      continua roxa, como se o integrador não tivesse pedido nada. Por isso
//      os nomes são conferidos contra o próprio styles.js, não contra uma
//      lista escrita à mão aqui.
//
//   3. São DOIS logotipos, um por lugar, e a herança entre eles é por par. Se
//      o `titleLogo` herdasse o `logoLight`, o logotipo inteiro apareceria
//      numa barra de 16px — e só no tema claro, para metade dos usuários.
//
//   4. Paleta sugerida é promessa de que funciona. Ícone branco sobre a aba
//      precisa de 3:1 (WCAG, elemento gráfico) e o texto da barra de 4.5:1 —
//      conferidos aqui, para nenhuma sugestão nascer ilegível.

import { readFile, readFile as lerArquivo } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const {
  normalizarMarca, cssDaMarca, trocasDeLink, nomeNosTextos,
  cssDaMarcaNaMoldura, tokensDaMarca, logoDaBarra, soNoSrcdoc,
  PALETAS, lerHex, contraste,
} = await import('../src/marca.js')
const { buildSrcdoc } = await import('../src/srcdoc.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const calado = (fn) => {
  const antes = console.warn
  console.warn = () => {}
  try { return fn() } finally { console.warn = antes }
}

const CSS = readFileSync(join(ROOT, 'src', 'styles.js'), 'utf8')
const TIPOS = readFileSync(join(ROOT, 'types', 'index.d.ts'), 'utf8')

/** Atalho: normaliza e devolve os tokens, que é como o widget os consome. */
const tk = (o) => tokensDaMarca(calado(() => normalizarMarca(o)))

console.log('\nmarca — o que o integrador pede é o que sai:')
{
  check('sem branding, nada muda', normalizarMarca(undefined) === null)
  check('objeto vazio também não vira peso', normalizarMarca({}) === null)

  const tudoFora = normalizarMarca({ logo: false, links: false })
  const css = cssDaMarca(tudoFora)
  check('o logotipo some', /img\.bcvoz-logo\{display:none!important\}/.test(css))
  for (const dominio of ['pabx.teambravotech.com', 'chat.whatsapp.com', 'bravotech.teambravotech.com']) {
    check(`o link de ${dominio} some`, css.includes(`a[href*="${dominio}"]{display:none!important}`))
  }
  check('e a linha inteira do rodapé some junto',
    /\.footer > div:first-child\{display:none!important\}/.test(css))
}

console.log('\nmarca — o nome do cliente no lugar do logotipo:')
{
  const comNome = normalizarMarca({ name: 'Acme Telecom' })
  const css = cssDaMarca(comNome)
  check('o logotipo sai', /img\.bcvoz-logo\{display:none!important\}/.test(css))
  // Um <img> é elemento substituído: ::after nele não desenha. O texto tem de
  // entrar no pai, e `:has()` é o que permite subir um nível sem JavaScript.
  check('o nome entra pelo pai do logotipo',
    css.includes(':has(> img.bcvoz-logo)::after') && css.includes('content:"Acme Telecom"'))
  check('e vira o nome nos textos da interface', nomeNosTextos(comNome) === 'Acme Telecom')

  const vazio = normalizarMarca({ name: '' })
  check('nome vazio não renderiza nada', !cssDaMarca(vazio).includes('::after'))
  check('mas ainda tira o logotipo',
    /img\.bcvoz-logo\{display:none!important\}/.test(cssDaMarca(vazio)))
  check('e tira a palavra dos textos', nomeNosTextos(vazio) === '')
  check('false é o mesmo que vazio', normalizarMarca({ name: false }).nome === '')
  check('sem a chave, os textos ficam como estão',
    nomeNosTextos(normalizarMarca({ links: false })) === null)

  check('espaços e quebras viram uma linha só',
    normalizarMarca({ name: '  Acme\n  Telecom  ' }).nome === 'Acme Telecom')
  check('o nome é limitado a 40 caracteres',
    normalizarMarca({ name: 'x'.repeat(80) }).nome.length === 40)

  // Imagem e nome disputam o mesmo espaço: a imagem manda, senão apareceriam
  // os dois empilhados.
  const dois = cssDaMarca(normalizarMarca({ name: 'Acme', logo: 'https://c.com/a.svg' }))
  check('com logo e nome, a imagem manda',
    dois.includes('content:url("https://c.com/a.svg")') && !dois.includes('::after'))
}

console.log('\nmarca — esconder um link não deixa separador órfão:')
{
  // O rodapé é `a · a · a`: os pontos são irmãos dos links. Escondendo só um
  // link, sobraria um ponto solto — parece defeito, não escolha.
  const css = cssDaMarca(normalizarMarca({ links: { support: false } }))
  check('o link escondido é só o pedido',
    css.includes('chat.whatsapp.com') && !css.includes('bravotech.teambravotech.com'))
  check('os separadores somem', /\.footer span\{display:none!important\}/.test(css))
  check('e o espaçamento abre no lugar deles', /\.footer > div:first-child\{gap:12px\}/.test(css))
  check('mas o rodapé continua de pé',
    !/first-child\{display:none!important\}/.test(css))
}

console.log('\nmarca — logotipo próprio entra no lugar:')
{
  const css = cssDaMarca(normalizarMarca({ logo: 'https://cliente.com/marca.svg' }))
  check('troca pela imagem do integrador',
    css.includes('content:url("https://cliente.com/marca.svg")!important'))
  check('com teto de altura, para não estourar o cabeçalho', /max-height:44px/.test(css))

  const dataUri = cssDaMarca(normalizarMarca({ logo: 'data:image/svg+xml;base64,AAA' }))
  check('data:image também vale', dataUri.includes('data:image/svg+xml;base64,AAA'))

  // Aspas e barras fechariam o url() e deixariam CSS solto no documento.
  const escapado = cssDaMarca(normalizarMarca({ logo: 'https://x.com/a").svg' }))
  check('aspas são escapadas', escapado.includes('a\\").svg'))
}

console.log('\nmarca — o logotipo do login tem versão clara e altura:')
{
  const dois = cssDaMarca(normalizarMarca({
    logo: 'https://x.com/escuro.svg', logoLight: 'https://x.com/claro.svg',
  }))
  check('a arte clara entra sob o atributo do tema',
    /:root\[data-bp-tema="claro"\] img\.bcvoz-logo\{content:url\("https:\/\/x\.com\/claro\.svg"\)/
      .test(dois), dois)
  check('e o seletor dela vence o geral por especificidade, não por ordem',
    dois.indexOf('escuro.svg') < dois.indexOf('claro.svg'))

  const so = cssDaMarca(normalizarMarca({ logo: 'https://x.com/e.svg' }))
  check('sem versão clara, nenhuma regra de tema é criada', !so.includes('data-bp-tema'))

  const alto = cssDaMarca(normalizarMarca({ logo: 'https://x.com/e.svg', logoHeight: 33 }))
  check('a altura pedida vira o teto', /max-height:33px/.test(alto), alto)
  check('altura absurda é aparada em 72',
    /max-height:72px/.test(cssDaMarca(normalizarMarca({ logo: 'https://x.com/e.svg', logoHeight: 900 }))))

  const soAltura = cssDaMarca(normalizarMarca({ logoHeight: 30 }))
  check('altura sem arte mexe no NOSSO logotipo, sem escondê-lo',
    /max-height:30px/.test(soAltura) && !soAltura.includes('display:none'), soAltura)
  check('e altura inválida não vira regra nenhuma',
    calado(() => normalizarMarca({ logoHeight: 'grande' })) === null)
}

console.log('\nmarca — URL torta vira aviso, não link quebrado:')
{
  for (const ruim of ['javascript:alert(1)', 'ftp://x.com/a.png', 'nao-e-url']) {
    check(`logo recusa ${JSON.stringify(ruim)}`,
      calado(() => normalizarMarca({ logo: ruim })) === null)
  }
  check('link recusa javascript:',
    calado(() => normalizarMarca({ links: { support: 'javascript:alert(1)' } })) === null)
  check('mas aceita mailto:',
    normalizarMarca({ links: { support: 'mailto:suporte@cliente.com' } }) !== null)
  check('e aceita tel:',
    normalizarMarca({ links: { support: 'tel:+5511999999999' } }) !== null)
  check('titleLogo torto também é recusado, e a barra fica com o texto',
    logoDaBarra(calado(() => normalizarMarca({ titleLogo: 'javascript:alert(1)', name: 'Acme' }))) === null)
}

console.log('\nmarca — trocar o destino exige o atributo, esconder não:')
{
  const so_esconde = normalizarMarca({ logo: false, links: false })
  check('esconder não pede observador', trocasDeLink(so_esconde).length === 0)

  const troca = normalizarMarca({ links: { support: 'https://wa.me/5511999999999' } })
  const pares = trocasDeLink(troca)
  check('trocar gera o par domínio → destino',
    pares.length === 1 && pares[0][0] === 'chat.whatsapp.com' &&
    pares[0][1] === 'https://wa.me/5511999999999', JSON.stringify(pares))
}

console.log('\nmarca — o srcdoc aplica antes do bundle:')
{
  const html = buildSrcdoc({
    version: '0', parentOrigin: 'https://x.com',
    marca: normalizarMarca({ logo: false, links: { support: 'https://wa.me/55' } }),
  })
  check('o CSS viaja no cfg', /img\.bcvoz-logo/.test(html))
  check('e é aplicado antes do popup.js',
    html.indexOf('marcaCss') < html.indexOf('popup.js'))
  check('as trocas viajam junto', /wa\.me/.test(html))

  const semMarca = buildSrcdoc({ version: '0', parentOrigin: 'https://x.com' })
  check('sem branding, o documento não carrega peso',
    /"marcaCss":null/.test(semMarca) && /"marcaLinks":\[\]/.test(semMarca))

  // A moldura é do SDK e não viaja para dentro do iframe: o logotipo da barra
  // não tem o que fazer lá, e levá-lo seria peso e uma segunda fonte da
  // verdade sobre qual arte está na tela.
  const soBarra = buildSrcdoc({
    version: '0', parentOrigin: 'https://x.com',
    marca: normalizarMarca({ titleLogo: 'https://x.com/mini.svg', palette: 'teal' }),
  })
  check('o logotipo da barra não entra no documento do webphone',
    !soBarra.includes('mini.svg'))
  check('nem a cor da moldura', !soBarra.includes('--bpw-marca'))

  // O estilo entra de fato no documento, e o observador só quando há troca.
  const rodar = (marca) => {
    const criados = []
    const html2 = buildSrcdoc({ version: '0', parentOrigin: 'https://x.com', marca })
    const script = html2.match(/<script>([\s\S]*?)<\\?\/script>/)[1]
    let observou = false
    vm.runInNewContext(script, {
      window: {
        addEventListener() {},
        MutationObserver: class { constructor() { observou = true } observe() {} },
      },
      document: {
        createElement: () => ({ textContent: '' }),
        head: { appendChild: (n) => criados.push(n) },
        documentElement: {},
        querySelectorAll: () => [],
        querySelector: () => null,
        activeElement: null, hasFocus: () => false,
      },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout: () => 0, Date, Number, JSON,
    })
    return { criados, observou }
  }

  const soEsconde = rodar(normalizarMarca({ logo: false }))
  check('o <style> é injetado no head', soEsconde.criados.length === 1)
  check('sem troca, nenhum observador é instalado', soEsconde.observou === false)

  const comTroca = rodar(normalizarMarca({ links: { portal: 'https://cliente.com' } }))
  check('com troca, o observador entra', comTroca.observou === true)
}

console.log('\nmarca — o nome alcança o título e os textos:')
{
  const html = buildSrcdoc({
    version: '0', parentOrigin: 'https://x.com', marca: normalizarMarca({ name: 'Acme' }),
  })
  check('o <title> do documento acompanha', /<title>Webphone Acme<\/title>/.test(html))
  check('a tabela de mensagens é reescrita antes do bundle',
    html.indexOf('__bpMessages') < html.indexOf('popup.js'))
  check('e depois do messages.js, que é quem a cria',
    html.indexOf('shim/messages.js') < html.indexOf('tabela[k].message'))

  const vazio = buildSrcdoc({
    version: '0', parentOrigin: 'https://x.com', marca: normalizarMarca({ name: '' }),
  })
  check('nome vazio deixa o título sem marca', /<title>Webphone<\/title>/.test(vazio))

  const sem = buildSrcdoc({ version: '0', parentOrigin: 'https://x.com' })
  check('sem branding, o título segue BCVOZ', /<title>Webphone BCVOZ<\/title>/.test(sem))
  check('e nenhuma mensagem é tocada', /var nome = null/.test(sem))

  // A substituição roda de verdade, sobre a forma da tabela do _locales.
  const rodarPatch = (htmlDoc) => {
    const tabela = {
      loginSubtitle: { message: 'Acesse seu webphone BCVOZ' },
      loginPortal: { message: 'Portal BCVOZ' },
      diag: { message: 'speedtest.bravophone.com' },
    }
    const trecho = htmlDoc.match(/<script>\s*\(function \(\) \{\s*\/\/ A marca tambem[\s\S]*?\}\)\(\);/)[0]
      .replace('<script>', '')
    vm.runInNewContext(trecho, { window: { __bpMessages: tabela } })
    return tabela
  }

  const comNome = rodarPatch(html)
  check('"Acesse seu webphone BCVOZ" vira o nome do cliente',
    comNome.loginSubtitle.message === 'Acesse seu webphone Acme', comNome.loginSubtitle.message)
  check('o domínio do speedtest fica intacto',
    comNome.diag.message === 'speedtest.bravophone.com')

  const semNome = rodarPatch(vazio)
  check('com nome vazio, a palavra some sem deixar espaço',
    semNome.loginSubtitle.message === 'Acesse seu webphone', semNome.loginSubtitle.message)
  check('e "Portal BCVOZ" vira só "Portal"',
    semNome.loginPortal.message === 'Portal', semNome.loginPortal.message)
}

console.log('\nmarca — o que só existe dentro do webphone avisa; o resto, não:')
{
  // O aviso do modo hospedado mirava o branding inteiro. Depois que a cor e o
  // logotipo da barra passaram a valer nos dois modos, avisar sobre eles
  // mandaria o integrador tirar o que está funcionando.
  check('name, logo e links são do documento',
    soNoSrcdoc(normalizarMarca({ name: 'Acme', logo: 'https://x.com/a.svg', links: false }))
      .join() === 'name,logo,links')
  check('cor e logotipo da barra não entram na queixa',
    soNoSrcdoc(calado(() => normalizarMarca({ palette: 'teal', titleLogo: 'https://x.com/m.svg' })))
      .length === 0)
}

console.log('\nmarca — a cor vira tokens que o CSS realmente usa:')
{
  const { comuns } = tk({ color: '#0f766e' })
  check('a cor pedida é a cor da aba', comuns['--bpw-marca'] === '#0f766e', comuns['--bpw-marca'])
  check('hover sai derivado, mais escuro', comuns['--bpw-marca-hover'] === '#0d6861',
    comuns['--bpw-marca-hover'])
  check('hover explícito vence o derivado',
    tk({ color: '#0f766e', colorHover: '#115e59' }).comuns['--bpw-marca-hover'] === '#115e59')
  check('sombra e halo são triplos r,g,b (rgba() não come hex)',
    /^\d+,\d+,\d+$/.test(comuns['--bpw-marca-sombra']) &&
    /^\d+,\d+,\d+$/.test(comuns['--bpw-marca-halo']))
  check('o realce clareia e o foco clareia mais',
    lerHex(comuns['--bpw-marca-clara'])[0] < lerHex(comuns['--bpw-marca-foco'])[0])

  // O ponto do teste: cada token produzido tem de ser consumido lá. Um nome
  // divergente deixaria a cor pedida sem efeito, sem erro nenhum. A lista vem
  // de uma marca COMPLETA, para a superfície entrar na conferência também.
  const completa = tk({
    color: '#0f766e', surface: '#122524', surfaceLight: '#ffffff', titleLogoHeight: 18,
  })
  for (const nome of [...Object.keys(completa.comuns), ...Object.keys(completa.claro)]) {
    check(`${nome} é lido pelo WIDGET_CSS`, CSS.includes(`var(${nome})`), nome)
  }
}

console.log('\nmarca — o padrão é a marca BCVOZ, intocada:')
{
  check('sem branding não sai token nenhum',
    Object.keys(tokensDaMarca(null).comuns).length === 0)
  check('sem branding não sai CSS nenhum', cssDaMarcaNaMoldura(null) === '')
  check('branding sem cor não inventa cor',
    tk({ logo: 'https://x.com/a.svg' }).comuns['--bpw-marca'] === undefined)
  check('cor fora do hex é ignorada, não aplicada torta',
    tk({ color: 'rebeccapurple' }).comuns['--bpw-marca'] === undefined)
  check('paleta desconhecida não inventa cor',
    tk({ palette: 'fucsia' }).comuns['--bpw-marca'] === undefined)
  // Se o :host perder um default, o widget sem branding sai com cor vazia.
  for (const nome of ['--bpw-marca', '--bpw-marca-hover', '--bpw-marca-clara',
    '--bpw-marca-foco', '--bpw-marca-sombra', '--bpw-marca-halo', '--bpw-logo-altura']) {
    check(`${nome} tem valor de fábrica no :host`,
      new RegExp(`\\n\\s*${nome}:\\s*[^;]+;`).test(CSS), nome)
  }
  check('o roxo BCVOZ sobrou só na declaração do token',
    (CSS.match(/#6c5ce7/g) || []).length === 1)

  // Regressão vista na tela: o logotipo era o único filho elástico da barra,
  // mas o max-width o travava antes de consumir o espaço. A sobra de um flex
  // com justify-content: flex-start cai DEPOIS do último filho — um buraco à
  // direita do botão de fechar. Margem automática come a sobra antes disso.
  const regraDoLogo = (CSS.match(/\.bp-logo\s*\{([^}]*)\}/) || ['', ''])[1]
  check('o logotipo não estica junto com o max-width',
    /flex:\s*0\s/.test(regraDoLogo), (regraDoLogo.match(/flex:[^;]*/) || [''])[0])
  check('a sobra da barra vira margem, não buraco depois do X',
    /margin-right:\s*auto/.test(regraDoLogo))
}

console.log('\nmarca — as paletas sugeridas são legíveis de verdade:')
{
  const ids = Object.keys(PALETAS)
  check('há sugestões suficientes para escolher', ids.length >= 6, ids.length)
  for (const [id, p] of Object.entries(PALETAS)) {
    check(`${id}: tem rótulo e as quatro cores`,
      !!p.label && !!lerHex(p.color) && !!lerHex(p.colorHover) &&
      !!lerHex(p.surface) && !!lerHex(p.surfaceLight))
    // O ícone da aba é branco: sem 3:1 ele some sobre a cor da marca.
    check(`${id}: ícone branco sobre a aba tem 3:1`,
      contraste(p.color, '#ffffff') >= 3, +contraste(p.color, '#ffffff').toFixed(2))
    check(`${id}: o hover escurece, não clareia`,
      lerHex(p.colorHover).reduce((a, b) => a + b) < lerHex(p.color).reduce((a, b) => a + b))
    // A barra de título usa --bpw-texto sobre --bpw-header-bg.
    const { comuns, claro } = tk({ palette: id })
    for (const [tema, t] of [['escuro', comuns], ['claro', claro]]) {
      check(`${id}: texto sobre a barra (${tema}) tem 4.5:1`,
        contraste(t['--bpw-header-bg'], t['--bpw-texto']) >= 4.5,
        +contraste(t['--bpw-header-bg'], t['--bpw-texto']).toFixed(2))
    }
    check(`${id}: está no tipo BCVozPaletteId`, TIPOS.includes(`'${id}'`))
  }
}

console.log('\nmarca — paleta e ajuste fino convivem:')
{
  const teal = tk({ palette: 'teal' }).comuns
  check('a paleta preenche cor e superfície',
    teal['--bpw-marca'] === PALETAS.teal.color && !!teal['--bpw-bg'])
  check('a cor avulsa vence a da paleta',
    tk({ palette: 'teal', color: '#b91c1c' }).comuns['--bpw-marca'] === '#b91c1c')
  check('o resto da paleta continua valendo',
    tk({ palette: 'teal', color: '#b91c1c' }).comuns['--bpw-marca-hover'] === PALETAS.teal.colorHover)
  check('cor sem paleta não mexe na superfície',
    tk({ color: '#b91c1c' }).comuns['--bpw-bg'] === undefined)
}

console.log('\nmarca — a superfície se adapta à própria luminância:')
{
  const escura = tk({ surface: '#122524' }).comuns
  check('fundo escuro pede texto claro', escura['--bpw-texto'] === '#e6e6f0', escura['--bpw-texto'])
  check('a barra fica mais escura que a janela',
    lerHex(escura['--bpw-header-bg'])[1] < lerHex(escura['--bpw-bg'])[1])
  const clara = tk({ surface: '#f8fafc' }).comuns
  check('fundo claro pede texto escuro (mesmo no bloco do tema escuro)',
    clara['--bpw-texto'] === '#161a24', clara['--bpw-texto'])
  check('contraste da escolha errada ainda é legível',
    contraste(clara['--bpw-header-bg'], clara['--bpw-texto']) >= 4.5)
}

console.log('\nmarca — a folha da moldura respeita os dois temas:')
{
  const css = cssDaMarcaNaMoldura(normalizarMarca({
    color: '#0f766e', surface: '#122524', surfaceLight: '#f1f5f9',
  }))
  check('tem bloco :host', /:host \{/.test(css))
  check('tem bloco do tema claro', /:host\(\[data-bp-tema="claro"\]\) \{/.test(css))
  const [escuro, claro] = css.split(':host([data-bp-tema="claro"])')
  check('o fundo escuro fica no bloco de cima', escuro.includes('--bpw-bg: #122524'))
  check('o fundo claro fica no bloco do tema claro', claro.includes('--bpw-bg: #f1f5f9'))
  check('a cor da marca não se repete no tema claro: identidade não troca',
    !claro.includes('--bpw-marca:'))
  check('só com surfaceLight, o bloco escuro nem aparece',
    !cssDaMarcaNaMoldura(normalizarMarca({ surfaceLight: '#fff' })).includes(':host {'))
}

console.log('\nmarca — a altura do logotipo da barra tem teto:')
{
  const t = (o) => tk(o).comuns['--bpw-logo-altura']
  check('altura pedida vira px', t({ titleLogoHeight: 20 }) === '20px')
  check('altura absurda é cortada em 24 (a barra tem 36)', t({ titleLogoHeight: 200 }) === '24px')
  check('altura inválida não vira token', t({ titleLogoHeight: 'grande' }) === undefined)
}

console.log('\nmarca — dois logotipos, um por lugar:')
{
  const MINI = 'https://cdn.acme.com/simbolo.svg'
  const INTEIRO = 'https://cdn.acme.com/logotipo.svg'

  const separados = normalizarMarca({ titleLogo: MINI, logo: INTEIRO })
  check('a barra recebe o mini', logoDaBarra(separados).escuro === MINI)
  check('o login recebe o inteiro', separados.logo === INTEIRO)

  // O defeito que este bloco existe para impedir: o logotipo por extenso
  // espremido em 16px, e só no tema claro.
  const misto = normalizarMarca({ titleLogo: MINI, logo: INTEIRO, logoLight: INTEIRO + '?claro' })
  check('o tema claro da barra NÃO herda o logoLight do login',
    logoDaBarra(misto).claro === MINI, logoDaBarra(misto).claro)
  check('mas o login usa a versão clara dele',
    cssDaMarca(misto).includes(INTEIRO + '?claro'))
  check('titleLogoLight, quando existe, é respeitado',
    logoDaBarra(normalizarMarca({ titleLogo: MINI, titleLogoLight: MINI + '?claro' })).claro
      === MINI + '?claro')

  check('o logo do login não sobe sozinho para a barra',
    logoDaBarra(normalizarMarca({ logo: INTEIRO })) === null)
  check('sem branding, a barra não recebe logotipo', logoDaBarra(null) === null)
  check('só titleLogo não mexe no documento do webphone',
    cssDaMarca(normalizarMarca({ titleLogo: MINI })) === '')
}

// ---------------------------------------------------------------------------
// Daqui para baixo o widget é montado de verdade, num DOM falso.
//
// O que as seções acima provam é que o módulo da marca responde certo. O que
// elas não alcançam é o fio entre ele e a barra de título: a folha da marca
// acrescentada na ordem errada, o <img> montado antes do header, a arte clara
// que nunca chega a ser escolhida. Nada disso quebra nada — só devolve a marca
// de fábrica, calada, para quem pagou por outra.
// ---------------------------------------------------------------------------

console.log('\nmarca — o título da janela segue o nome:')
{
  const widget = await lerArquivo(join(ROOT, 'src/widget.js'), 'utf8')
  check('sem title explícito, o nome do branding vira o título',
    /marca && marca\.nome !== null \? marca\.nome : 'BCVOZ'/.test(widget))
  check('título vazio não renderiza elemento nenhum',
    /\.\.\.\(marcaEl \? \[marcaEl\] : \[\]\)/.test(widget) &&
    /titulo \? h\('span', \{ class: 'bp-title'/.test(widget))
  check('e o nome acessível do iframe acompanha',
    /title: titulo \? 'Webphone ' \+ titulo : 'Webphone'/.test(widget))
}

function elFalso(tag) {
  const el = {
    tagName: tag.toUpperCase(),
    children: [], attrs: {}, textContent: '', className: '', innerHTML: '',
    hidden: false, offsetHeight: 48, offsetWidth: 120, dataset: {},
    style: {
      props: {}, cssText: '',
      setProperty(k, v) { this.props[k] = v },
      getPropertyValue(k) { return this.props[k] || '' },
    },
    classList: {
      set: new Set(),
      add(...c) { c.forEach((x) => this.set.add(x)) },
      remove(...c) { c.forEach((x) => this.set.delete(x)) },
      contains(c) { return this.set.has(c) },
      toggle(c, on) { on ? this.set.add(c) : this.set.delete(c) },
    },
    setAttribute(k, v) { this.attrs[k] = String(v) },
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null },
    removeAttribute(k) { delete this.attrs[k] },
    hasAttribute(k) { return k in this.attrs },
    appendChild(c) { this.children.push(c); c.parentNode = this; return c },
    append(...cs) { cs.forEach((c) => this.appendChild(c)) },
    replaceChild() {}, remove() {}, focus() {},
    addEventListener() {}, removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 380, height: 640, top: 0, left: 0 }),
    attachShadow() { this.shadow = elFalso('#shadow'); return this.shadow },
    contentWindow: { postMessage() {} },
  }
  // `src` tem de virar atributo: é por ele que o teste enxerga o logotipo.
  Object.defineProperty(el, 'src', {
    get() { return this.attrs.src }, set(v) { this.attrs.src = v },
  })
  return el
}

let temaClaroNoSistema = false
globalThis.document = {
  body: elFalso('body'),
  createElement: (t) => elFalso(t),
  addEventListener() {}, removeEventListener() {},
  hidden: false, visibilityState: 'visible',
}
// Os ouvintes de 'message' ficam guardados: é por eles que o teste entrega um
// theme:changed como o webphone entregaria, em vez de chamar função interna.
const ouvintesDeMensagem = new Set()
globalThis.window = {
  innerWidth: 1280, innerHeight: 800,
  location: { origin: 'https://acme.com', href: 'https://acme.com/', protocol: 'https:' },
  addEventListener(tipo, fn) { if (tipo === 'message') ouvintesDeMensagem.add(fn) },
  removeEventListener(tipo, fn) { if (tipo === 'message') ouvintesDeMensagem.delete(fn) },
  matchMedia: () => ({ matches: temaClaroNoSistema, addEventListener() {}, removeEventListener() {} }),
  setTimeout, clearTimeout, setInterval, clearInterval,
  devicePixelRatio: 1,
}
globalThis.location = globalThis.window.location
const guardado = new Map()
globalThis.localStorage = {
  getItem: (k) => (guardado.has(k) ? guardado.get(k) : null),
  setItem: (k, v) => guardado.set(k, String(v)),
  removeItem: (k) => guardado.delete(k),
}

const { createWidget } = await import('../src/widget.js')

const base = { version: '0.0.0', emit: () => {}, mode: 'srcdoc' }
const achar = (el, pred) => {
  if (pred(el)) return el
  for (const c of el.children || []) { const r = achar(c, pred); if (r) return r }
  return null
}
const porClasse = (api, classe) => achar(api.el.shadow, (e) => e.className === classe)
const folhas = (api) => api.el.shadow.children.filter((e) => e.tagName === 'STYLE')

console.log('\nmontagem — marca completa, com os dois logotipos:')
{
  const api = createWidget({ ...base, branding: {
    name: 'ACME Telecom',
    titleLogo: 'https://cdn.acme.com/mini.svg',
    titleLogoLight: 'https://cdn.acme.com/mini-claro.svg',
    logo: 'https://cdn.acme.com/full.svg',
    palette: 'teal',
    titleLogoHeight: 20,
  } })
  const img = porClasse(api, 'bp-logo')
  check('o mini entrou na barra como <img>', img?.tagName === 'IMG')
  check('a barra usa o mini, não o inteiro',
    img?.attrs.src === 'https://cdn.acme.com/mini.svg', img?.attrs.src)
  check('alt é o nome da marca', img?.attrs.alt === 'ACME Telecom')
  check('draggable=false: a barra inteira continua sendo a alça de arraste',
    img?.attrs.draggable === 'false')
  check('o texto do título sai de cena', !porClasse(api, 'bp-title'))

  const marca = folhas(api)[1]
  check('a folha da marca vem DEPOIS do WIDGET_CSS', folhas(api).length === 2 && !!marca)
  check('a cor da paleta está na folha',
    marca?.textContent.includes(`--bpw-marca: ${PALETAS.teal.color}`))
  check('a superfície da paleta também', marca?.textContent.includes('--bpw-bg:'))
  check('a altura do logotipo foi junto', marca?.textContent.includes('--bpw-logo-altura: 20px'))

  const frame = porClasse(api, 'bp-frame')
  check('o rótulo do iframe segue a marca',
    frame?.attrs.title === 'Webphone ACME Telecom', frame?.attrs.title)
  check('o srcdoc leva o INTEIRO para dentro do app',
    frame?.attrs.srcdoc.includes('content:url(\\"https://cdn.acme.com/full.svg\\")'),
    frame?.attrs.srcdoc.slice(0, 0))
  check('e não leva o mini', !frame?.attrs.srcdoc.includes('mini.svg'))
  api.destroy()
}

console.log('\nmontagem — sem branding, nada muda:')
{
  const api = createWidget({ ...base })
  check('a barra continua com o texto BCVOZ',
    porClasse(api, 'bp-title')?.textContent === 'BCVOZ')
  check('nenhuma folha além do WIDGET_CSS', folhas(api).length === 1, folhas(api).length)
  check('o iframe mantém o rótulo de fábrica',
    porClasse(api, 'bp-frame')?.attrs.title === 'Webphone BCVOZ')
  api.destroy()
}

console.log('\nmontagem — logo: false tira a marca em vez de trocá-la:')
{
  const api = createWidget({ ...base, branding: { logo: false, name: '' } })
  const titulo = porClasse(api, 'bp-title')
  check('a barra fica sem texto e sem elemento', !titulo && !porClasse(api, 'bp-logo'))
  const frame = porClasse(api, 'bp-frame')
  check('o logotipo de dentro do app é escondido',
    /display:none!important/.test(frame?.attrs.srcdoc || ''))
  check('sem nome, o iframe cai no rótulo genérico',
    frame?.attrs.title === 'Webphone', frame?.attrs.title)
  api.destroy()
}

console.log('\nmontagem — só a cor, sem logotipo nenhum:')
{
  const api = createWidget({ ...base, branding: { palette: 'crimson' } })
  check('a barra mantém o texto de fábrica',
    porClasse(api, 'bp-title')?.textContent === 'BCVOZ')
  check('mas a cor é a pedida',
    folhas(api)[1]?.textContent.includes(`--bpw-marca: ${PALETAS.crimson.color}`))
  check('e o documento do webphone não recebe CSS de marca',
    /"marcaCss":null/.test(porClasse(api, 'bp-frame')?.attrs.srcdoc || ''))
  api.destroy()
}

console.log('\nmontagem — o logotipo da barra acompanha o tema:')
{
  const api = createWidget({ ...base, branding: {
    titleLogo: 'https://cdn.acme.com/mini.svg',
    titleLogoLight: 'https://cdn.acme.com/mini-claro.svg',
  } })
  const img = porClasse(api, 'bp-logo')
  const frame = porClasse(api, 'bp-frame')
  check('no escuro, a arte escura', img?.attrs.src === 'https://cdn.acme.com/mini.svg')

  // O caminho de verdade: o webphone avisa por postMessage, a ponte entrega o
  // theme:changed e a moldura reage. Chamar a função interna provaria menos —
  // é este fio, do iframe até o <img>, que a tela mostra quebrado.
  const avisar = (theme) => {
    for (const fn of ouvintesDeMensagem) {
      fn({
        origin: 'https://acme.com', source: frame.contentWindow,
        data: { protocol: 'bravophone/v1', type: 'event', name: 'theme:changed', payload: { theme } },
      })
    }
  }
  avisar('claro')
  check('o webphone avisa claro e a arte clara entra',
    img?.attrs.src === 'https://cdn.acme.com/mini-claro.svg', img?.attrs.src)
  check('e a moldura vai junto', api.el.getAttribute('data-bp-tema') === 'claro')
  avisar('escuro')
  check('e volta quando o tema volta',
    img?.attrs.src === 'https://cdn.acme.com/mini.svg', img?.attrs.src)
  api.destroy()
}

console.log('\nmontagem — sem arte clara, a mesma serve aos dois temas:')
{
  const api = createWidget({ ...base, branding: { titleLogo: 'https://cdn.acme.com/mini.svg' } })
  const img = porClasse(api, 'bp-logo')
  const frame = porClasse(api, 'bp-frame')
  for (const fn of ouvintesDeMensagem) {
    fn({
      origin: 'https://acme.com', source: frame.contentWindow,
      data: { protocol: 'bravophone/v1', type: 'event', name: 'theme:changed', payload: { theme: 'claro' } },
    })
  }
  check('o tema claro não apaga o logotipo',
    img?.attrs.src === 'https://cdn.acme.com/mini.svg', img?.attrs.src)
  api.destroy()
}

console.log('\nmontagem — o tema do sistema decide a primeira arte:')
{
  temaClaroNoSistema = true
  const api = createWidget({ ...base, branding: {
    titleLogo: 'https://cdn.acme.com/mini.svg',
    titleLogoLight: 'https://cdn.acme.com/mini-claro.svg',
  } })
  check('sistema no claro: nasce com a arte clara',
    porClasse(api, 'bp-logo')?.attrs.src === 'https://cdn.acme.com/mini-claro.svg',
    porClasse(api, 'bp-logo')?.attrs.src)
  api.destroy()
  temaClaroNoSistema = false
}

console.log('\nmarca — os seletores ainda batem com o host de verdade:')
{
  const popup = join(ROOT, 'host/popup.js')
  if (!existsSync(popup)) {
    console.log('  · host/popup.js ausente (rode `npm run sync`) — pulando')
  } else {
    const js = await readFile(popup, 'utf8')
    check('o bundle ainda usa a classe bcvoz-logo', js.includes('bcvoz-logo'))
    check('e ainda aponta para o portal', js.includes('pabx.teambravotech.com'))
    check('e para o suporte no WhatsApp', js.includes('chat.whatsapp.com'))
    check('e para o Portal BCVOZ', js.includes('bravotech.teambravotech.com'))
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
