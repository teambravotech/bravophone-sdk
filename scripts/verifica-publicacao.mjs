#!/usr/bin/env node
/**
 * verifica-publicacao.mjs — confere no CDN o que acabou de ser publicado.
 *
 * POR QUE EXISTE: entre o `npm publish` e o integrador há dois intermediários
 * que podem estar servindo outra coisa — o registro do npm e as bordas do
 * jsDelivr. O `npm test` roda contra os arquivos desta máquina; isto roda
 * contra as URLs que o cliente carrega de verdade.
 *
 * E confere a pergunta que decide se a publicação quebrou produção: QUAL
 * versão o resolvedor do jsDelivr está devolvendo. O snippet recomendado no
 * README pergunta a ele e carrega o que vier — então publicar sob a tag
 * `latest` move todo integrador em minutos, e publicar sob outra tag não move
 * ninguém.
 *
 * Uso:
 *   node scripts/verifica-publicacao.mjs            # a versão do package.json
 *   node scripts/verifica-publicacao.mjs 0.9.0
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const versao = process.argv[2] || pkg.version
const NOME = pkg.name
const CDN = `https://cdn.jsdelivr.net/npm/${NOME}@${versao}`

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const buscar = async (url, how = 'text') => {
  const r = await fetch(url, { cache: 'no-store' })
  if (!r.ok) return { erro: `${r.status} ${r.statusText}` }
  return { corpo: how === 'json' ? await r.json() : await r.text(), tamanho: +r.headers.get('content-length') || 0 }
}

console.log(`\nVerificação de publicação — ${NOME}@${versao}`)

console.log('\nregistro do npm:')
{
  const { corpo, erro } = await buscar(`https://registry.npmjs.org/${NOME}`, 'json')
  if (erro) { check('o registro responde', false, erro) }
  else {
    check(`a versão ${versao} existe no registro`, !!corpo.versions[versao])
    const latest = corpo['dist-tags'].latest
    check(`dist-tag latest = ${latest}`, true)
    if (latest !== versao) {
      console.log(`    · produção continua na ${latest}. Para promover:`)
      console.log(`      npm dist-tag add ${NOME}@${versao} latest`)
    } else {
      console.log('    · esta versão JÁ é a de produção para quem usa o snippet do README.')
    }
    const outras = Object.entries(corpo['dist-tags']).filter(([t]) => t !== 'latest')
    if (outras.length) console.log('    · outras tags: ' + outras.map(([t, v]) => `${t}=${v}`).join(', '))
  }
}

console.log('\nbundle no CDN:')
{
  const { corpo, erro } = await buscar(`${CDN}/dist/bcvoz.umd.js`)
  if (erro) { check('o bundle baixa', false, erro) }
  else {
    check('o bundle baixa', true)
    const janela = {}
    try {
      new Function('window', 'self', 'globalThis', 'module', 'exports', corpo)(
        janela, janela, janela, { exports: {} }, {})
    } catch (err) { check('o bundle avalia sem erro', false, err.message) }
    const api = janela.BCVoz
    check('expõe window.BCVoz', !!api)
    check(`BCVoz.version === '${versao}'`, api?.version === versao, api?.version)
    check('a API antiga continua inteira',
      ['init', 'destroy', 'on', 'call', 'setAuth', 'toggle'].every((k) => typeof api?.[k] === 'function'))
    // As paletas nasceram na 0.9.0: cobrar isso de uma versão anterior seria
    // um falso vermelho, e este script também serve para olhar o passado.
    const [maior, menor] = versao.split('.').map(Number)
    if (maior > 0 || menor >= 9) {
      check('as paletas chegaram congeladas',
        !!api?.palettes && Object.isFrozen(api.palettes) && !!api.palettes.teal)
    } else {
      console.log('  · paletas: não se aplica antes da 0.9.0')
    }
  }
}

console.log('\nassets do host no CDN (é de onde o srcdoc carrega):')
{
  const { corpo, erro } = await buscar(`${CDN}/host/index.html`)
  if (erro) { check('host/index.html baixa', false, erro) }
  else {
    check('host/index.html baixa', true)
    check('o public path aponta para esta versão',
      corpo.includes(`${NOME}@${versao}/host/`) ||
      !corpo.includes('cdn.jsdelivr.net'), 'o HTML cita outra versão')
  }
  for (const arquivo of ['host/popup.js', 'host/shim/chrome-shim.js', 'host/css/dark-theme.css',
    'host/fonts/Audiowide-Regular.ttf']) {
    const r = await fetch(`${CDN}/${arquivo}`, { method: 'HEAD' })
    check(`${arquivo} responde`, r.ok, r.status)
  }
}

console.log('\nresolvedor de versão (o que o snippet do README carrega):')
{
  const { corpo, erro } = await buscar(
    `https://data.jsdelivr.com/v1/packages/npm/${NOME}/resolved`, 'json')
  if (erro) check('o resolvedor responde', false, erro)
  else {
    console.log(`  · hoje ele devolve: ${corpo.version}`)
    if (corpo.version === versao) {
      console.log('    Todo integrador com o snippet recomendado está nesta versão.')
      console.log(`    Voltar atrás: npm dist-tag add ${NOME}@<anterior> latest && node scripts/purge-cdn.mjs`)
    } else {
      console.log('    Produção ainda não se mexeu — a publicação está em espera.')
    }
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
