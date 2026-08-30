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

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
