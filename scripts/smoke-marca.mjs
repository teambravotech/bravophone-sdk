// White-label: a marca BCVOZ sai da tela quando o integrador pede.
//
// POR QUE EXISTE: quem revende o webphone dentro do próprio produto não pode
// mostrar o logotipo de outra empresa, nem um "Suporte" que leva a pessoa
// para um grupo de WhatsApp que não é o dele, no meio do login.
//
// O que este teste trava são os SELETORES. Eles são o contrato com um bundle
// minificado: a classe `bcvoz-logo`, a classe `footer` e o domínio de cada
// link. Se a extensão mudar qualquer um deles, a marca volta à tela sem que
// ninguém perceba — e é isso que as checagens contra o host de verdade pegam.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { normalizarMarca, cssDaMarca, trocasDeLink, nomeNosTextos } =
  await import('../src/marca.js')
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

console.log('\nmarca — o título da janela segue o nome:')
{
  const widget = await readFile(join(ROOT, 'src/widget.js'), 'utf8')
  check('sem title explícito, o nome do branding vira o título',
    /marca && marca\.nome !== null \? marca\.nome : 'BCVOZ'/.test(widget))
  check('título vazio não renderiza elemento nenhum',
    /\.\.\.\(titulo \? \[h\('span', \{ class: 'bp-title'/.test(widget))
  check('e o nome acessível do iframe acompanha',
    /title: titulo \? 'Webphone ' \+ titulo : 'Webphone'/.test(widget))
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
