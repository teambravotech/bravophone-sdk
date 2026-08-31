// Verifica o pacote como um CDN e um bundler o veem.
//
// Existe por causa de um bug real: os campos de CDN apontavam para um arquivo
// .cjs, que jsDelivr e unpkg servem como `application/node`. Com
// `X-Content-Type-Options: nosniff`, o navegador RECUSA esse MIME num
// <script src> — ou seja, a linha de integração do README não funcionava, e
// nada em Node acusava isso.

import { readFile, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? '  → ' + extra : ''}`) }
}

console.log('\npacote — o que o navegador carrega por <script src>:')
{
  // Extensões que os CDNs servem como application/javascript.
  const SERVIVEL = /\.(js|mjs)$/
  for (const field of ['unpkg', 'jsdelivr', 'browser', 'main']) {
    const v = pkg[field]
    check(`${field} termina em .js ou .mjs`, !!v && SERVIVEL.test(v), v)
    check(`${field} não usa .cjs (vira application/node)`, !!v && !v.endsWith('.cjs'), v)
  }
}

console.log('\npacote — os arquivos apontados existem:')
{
  const alvos = new Set([pkg.main, pkg.module, pkg.unpkg, pkg.jsdelivr, pkg.browser,
    pkg.types, pkg.exports?.['.']?.import, pkg.exports?.['.']?.require,
    pkg.exports?.['.']?.types].filter(Boolean))
  for (const rel of alvos) {
    check(`existe ${rel}`, existsSync(join(ROOT, rel.replace(/^\.\//, ''))))
  }
}

console.log('\npacote — o UMD expõe a global:')
{
  const umd = await readFile(join(ROOT, pkg.unpkg.replace(/^\.\//, '')), 'utf8')
  check('atribui window.Bravophone', /window\.Bravophone\s*=/.test(umd))
  // exports:'default' evita que a global vire o namespace do módulo, o que
  // obrigaria o integrador a escrever Bravophone.default.call().
  check('não exporta namespace com .default', !/exports\.default\s*=/.test(umd))
  check('sem referência a sourcemap (os .map não vão no pacote)',
    !/sourceMappingURL/.test(umd))
}

console.log('\npacote — o que vai no tarball:')
{
  const files = pkg.files || []
  check('inclui dist', files.some((f) => f.startsWith('dist')))
  check('inclui types', files.includes('types'))
  check('inclui README.md', files.includes('README.md'))
  // O host viaja junto de propósito: uma versão só para SDK e webphone,
  // sem matriz de compatibilidade entre dois pacotes.
  check('inclui host/ (o modo srcdoc o busca no CDN)', files.includes('host'))
  check('NÃO inclui os sourcemaps', !files.some((f) => f.includes('.map')))
  // Com "type":"module" o Vite emitiria .cjs para o UMD, reintroduzindo o bug.
  check('sem "type":"module" (senão o UMD volta a ser .cjs)', pkg.type === undefined, pkg.type)
}

console.log('\nhost — o que o modo srcdoc carrega:')
{
  const precisa = [
    'host/popup.js', 'host/js/libwebphone.js', 'host/js/bravophone-route-selector.js',
    'host/css/dark-theme.css', 'host/styles/theme-fixes.css',
    'host/shim/chrome-shim.js', 'host/shim/guest-bridge.js', 'host/shim/messages.js',
    'host/fonts/Audiowide-Regular.ttf', 'host/fonts/Seguiemj.ttf',
  ]
  for (const rel of precisa) check(`existe ${rel}`, existsSync(join(ROOT, rel)))
}

// --strict: usado no prepublishOnly. Sem ele, um host apontando para
// localhost é modo de desenvolvimento e não deve reprovar a suíte.
const STRICT = process.argv.includes('--strict')

console.log('\nhost — para onde os assets apontam:')
{
  // Se o public path apontar para outra versão, o pacote publicado busca
  // assets que podem não existir — e o sintoma só aparece em runtime, no
  // navegador do cliente, como fonte e ícones faltando.
  const bundle = existsSync(join(ROOT, 'host/popup.js'))
    ? await readFile(join(ROOT, 'host/popup.js'), 'utf8')
    : ''
  const m = bundle.match(/n\.p="([^"]*)"/)
  const esperado = `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/host/`
  check('public path presente no bundle', !!m, m && m[1])

  const dev = !!m && /^http:\/\/localhost/.test(m[1])
  if (dev && !STRICT) {
    console.log(`  · host em modo desenvolvimento (${m[1]})`)
    console.log('    rode `npm run prepare:host` antes de publicar')
  } else {
    check('public path bate com nome e versão do pacote',
      !!m && m[1] === esperado, m ? `\n      achado:   ${m[1]}\n      esperado: ${esperado}` : '')
    check('public path é https absoluto (srcdoc não resolve relativo)',
      !!m && m[1].startsWith('https://'), m && m[1])
  }
}

console.log('\npadrão — não depende de host externo:')
{
  // O padrão era mode:'hosted', apontando para webphone.bravophone.com — um
  // domínio que não existe em DNS. Quem fizesse init({token}) sem informar o
  // modo batia em NXDOMAIN, antes de qualquer preflight de CORS.
  const umd = await readFile(join(ROOT, pkg.unpkg.replace(/^\.\//, '')), 'utf8')
  const m = umd.match(/mode:[A-Za-z$_]*="([a-z]+)"/)
  check('modo padrão é srcdoc', !!m && m[1] === 'srcdoc', m && m[1])
  check('nenhum host bravophone.com embutido', !/webphone\.bravophone\.com/.test(umd))
  check('o srcdoc busca no CDN', /cdn\.jsdelivr\.net/.test(umd))
}

console.log('\npacote — a versão é única:')
{
  // A versão estava escrita à mão no src/index.js e ficou para trás no bump
  // para 0.1.1: o pacote publicado se identificava como 0.1.0. Agora ela é
  // injetada do package.json em build time, e este teste guarda isso.
  const umd = await readFile(join(ROOT, pkg.unpkg.replace(/^\.\//, '')), 'utf8')
  const m = umd.match(/version:\s*"([0-9][^"]*)"/)
  check('o bundle reporta a versão do package.json',
    !!m && m[1] === pkg.version, m ? `bundle=${m[1]} package=${pkg.version}` : 'não encontrada')

  const src = await readFile(join(ROOT, 'src/index.js'), 'utf8')
  check('nenhuma versão escrita à mão no fonte', !/version:\s*'[0-9]/.test(src))
}

console.log('\nexemplos — as referências locais existem:')
{
  // Ao trocar o UMD de .cjs para .js, os exemplos continuaram pedindo o nome
  // antigo e quebravam com 404. Nada em Node acusava — só o console do
  // navegador. Este teste resolve cada src/href relativo contra o disco.
  const dir = join(ROOT, 'examples')
  for (const nome of (await readdir(dir)).filter((f) => f.endsWith('.html'))) {
    const html = await readFile(join(dir, nome), 'utf8')
    const refs = [...html.matchAll(/(?:src|href)="(\.\.?\/[^"]+)"/g)].map((m) => m[1])
    for (const ref of refs) {
      const alvo = resolve(dir, ref.split(/[?#]/)[0])
      check(`${nome} → ${ref}`, existsSync(alvo))
    }
  }
}

console.log('\npacote — metadados de publicação:')
{
  check('escopo @bravophone', pkg.name.startsWith('@bravophone/'), pkg.name)
  check('access public (CDN não serve pacote privado)',
    pkg.publishConfig?.access === 'public', pkg.publishConfig?.access)
  check('repository preenchido', !!pkg.repository?.url)
  check('prepublishOnly roda build e testes',
    /build/.test(pkg.scripts?.prepublishOnly || '') && /test/.test(pkg.scripts?.prepublishOnly || ''))
}

console.log('\naviso de sem ramal — os dois arquivos andam juntos:')
{
  // O mesmo código vive na extensão (js/bravophone-sem-ramal.js) e no SDK
  // (host/shim/guest-bridge.js). São arquivos separados por necessidade, e já
  // foram editados em paralelo mais de uma vez — quando um dos dois fica para
  // trás, o aviso sai com outra cara em um dos produtos.
  const daExtensao = await readFile(
    resolve(ROOT, '..', 'Bravophone', 'js', 'bravophone-sem-ramal.js'), 'utf8')
  const doSdk = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')

  const recorte = (fonte) => {
    const i = fonte.indexOf('.bp-aviso-ramal{')
    const j = fonte.indexOf('document.head.appendChild(css)', i)
    return i < 0 || j < 0 ? null : fonte.slice(i, j)
  }
  const a = recorte(daExtensao)
  const b = recorte(doSdk)
  check('o bloco de estilo existe nos dois', !!a && !!b)
  check('e é idêntico', a === b,
    a === b ? '' : `extensão ${a?.length} chars, sdk ${b?.length}`)

  for (const [nome, fonte] of [['extensão', daExtensao], ['sdk', doSdk]]) {
    // Cartão, não faixa sangrada: é o que o deixa parecido com o resto do app.
    check(`${nome}: o aviso é um cartão recuado`,
      /left:8px;top:8px/.test(fonte) && /border-radius:10px/.test(fonte))
    // Reserva espaço encolhendo o shell por dentro. Inserir o cartão na lista
    // de filhos que o Vue diffa fazia o webphone desmontar, e o
    // `unmounted(){location.reload()}` dele recarregava a página em loop.
    check(`${nome}: reserva espaço sem entrar na árvore do Vue`,
      /body\.bp-sem-ramal \.webphone-shell-main/.test(fonte) &&
      !/insertBefore\(avisoEl/.test(fonte))
    check(`${nome}: e mede a altura real do aviso`,
      /--bp-aviso-altura/.test(fonte) && /offsetHeight/.test(fonte))
    // Uma linha só, sem botão: o portal continua acessível pela aba Ajustes.
    check(`${nome}: é inline, sem pílula de portal`,
      !/bp-aviso-link/.test(fonte) && /align-items:center/.test(fonte))
    // O container de toast é fixo em top:1em e ficava atrás do cartão, levando
    // junto os outros avisos do app (microfone, por exemplo).
    check(`${nome}: desce os toasts do bundle em vez de escondê-los`,
      /Vue-Toastification__container\[class\*="top-"\]/.test(fonte))
    // Os toasts vinham com o tema de fábrica do Vue-Toastification: retângulos
    // chapados, texto branco de 16px em Lato, 326px de largura mínima.
    check(`${nome}: os toasts usam a linguagem do app`,
      /bp-estilo-toasts/.test(fonte) &&
      ['error', 'warning', 'success', 'info'].every(
        (t) => fonte.includes(`'${t}'`)))
    check(`${nome}: e cabem num painel estreito`,
      /min-width:0!important/.test(fonte))
    // O shell é flex-row: sem prender à coluna do discador, os avisos passam
    // por cima do painel de recentes que fica ao lado.
    check(`${nome}: avisos param na divisa da coluna do discador`,
      /--bp-painel-larg/.test(fonte) && /webphone-shell-main/.test(fonte) &&
      !/right:8px/.test(fonte))
    // O toast do bundle diz a mesma coisa; sem escondê-lo ficavam dois avisos.
    check(`${nome}: esconde o toast duplicado do bundle`,
      /Vue-Toastification__toast/.test(fonte))
    // O tema marca display com !important; style inline simples não esconde.
    check(`${nome}: esconde com !important, que é o que funciona aqui`,
      /setProperty\('display', 'none', 'important'\)/.test(fonte))
  }
}

console.log('\nas duas páginas do host carregam o mesmo:')
{
  // Há dois pontos de entrada — host/index.html (modo hosted) e o documento do
  // buildSrcdoc — e eles precisam listar os MESMOS scripts na MESMA ordem.
  // Quando o index.html ficou para trás, faltando o bravophone-input.js, cada
  // tecla digitada entrava duas vezes: sem aquele arquivo ninguém desligava o
  // atalho de teclado do guest-bridge, que somava ao listener do bundle.
  const { buildSrcdoc } = await import('../src/srcdoc.js')
  const scripts = (html) =>
    [...html.matchAll(/<script[^>]*src="[^"]*?([^/"]+\.js)"/g)].map((m) => m[1])

  const doIndex = scripts(await readFile(join(ROOT, 'host/index.html'), 'utf8'))
  const doSrcdoc = scripts(buildSrcdoc({ version: '0', parentOrigin: 'https://x' }))

  check('host/index.html tem scripts', doIndex.length > 0)
  check('a lista é a mesma, na mesma ordem',
    doIndex.join(' > ') === doSrcdoc.join(' > '),
    `index: ${doIndex.join(', ')} | srcdoc: ${doSrcdoc.join(', ')}`)
  check('o campo de discagem vem antes do popup.js',
    doIndex.indexOf('bravophone-input.js') >= 0 &&
    doIndex.indexOf('bravophone-input.js') < doIndex.indexOf('popup.js'),
    doIndex.join(', '))
}

console.log('\nnenhum dos nossos arquivos derruba o app:')
{
  // O shell inteiro está atrás de `isLogged`:
  //     t.isLogged ? webphone-shell : the-login
  // e o componente do webphone tem `unmounted(){ document.location.reload() }`.
  // Qualquer commit nosso que desligue essa flag vira recarga; e como o motivo
  // do commit sobrevive à recarga, vira recarga em LOOP. Já aconteceu: o
  // heartbeat tomava 401 e mandava para o login.
  const NOSSOS = [
    ['extensão', '../Bravophone/js'],
    ['sdk', 'host/js'],
  ]
  const PROIBIDOS = ['setIsLogged', 'clearToken', 'clearUser', 'clearExtension']

  for (const [nome, dir] of NOSSOS) {
    const base = resolve(ROOT, dir)
    if (!existsSync(base)) continue
    for (const arq of await readdir(base)) {
      if (!arq.startsWith('bravophone-') || !arq.endsWith('.js')) continue
      const fonte = await readFile(join(base, arq), 'utf8')
      // Procura a CHAMADA de commit, não a menção em comentário.
      const achados = PROIBIDOS.filter(
        (m) => new RegExp(`commit\\s*\\(\\s*['"\`]${m}`).test(fonte))
      check(`${nome}/${arq} não desliga a sessão`,
        achados.length === 0, achados.join(', '))
    }
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
