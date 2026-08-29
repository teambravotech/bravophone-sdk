#!/usr/bin/env node
/**
 * purge-cdn.mjs — limpa o cache do jsDelivr nas URLs que não têm versão fixa.
 *
 * Rode DEPOIS de cada `npm publish`. Sem isso, quem usa a URL sem versão ou
 * com range continua recebendo a versão anterior das bordas do CDN.
 *
 * Atenção ao limite disto: o purge alcança os servidores do CDN, NÃO o cache
 * que já está no navegador de quem baixou. Essas URLs são entregues com
 * max-age de 7 dias, então um usuário que carregou ontem só vai revalidar na
 * semana que vem. Para atualização confiável, use examples/loader-latest.js.
 */
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
const [maior, menor] = pkg.version.split('.')

const alvos = [
  pkg.name,                          // sem versão
  `${pkg.name}@${maior}`,            // faixa maior
  `${pkg.name}@${maior}.${menor}`,   // faixa minor
]

console.log(`\nPurga do jsDelivr — ${pkg.name}@${pkg.version}\n`)

let falhas = 0
for (const alvo of alvos) {
  try {
    const resp = await fetch(`https://purge.jsdelivr.net/npm/${alvo}`)
    const dados = await resp.json().catch(() => ({}))
    const ok = resp.ok && dados.status !== 'failed'
    console.log(`  ${ok ? '✓' : '✗'} ${alvo}  ${dados.status || resp.status}`)
    if (!ok) falhas++
  } catch (err) {
    console.log(`  ✗ ${alvo}  ${err.message}`)
    falhas++
  }
}

// Confere o que o resolvedor de versão passa a responder — é dele que o
// loader-latest depende para achar a versão nova.
try {
  const meta = await fetch(`https://data.jsdelivr.com/v1/packages/npm/${pkg.name}/resolved`)
  const { version } = await meta.json()
  const igual = version === pkg.version
  console.log(`\n  ${igual ? '✓' : '·'} o CDN resolve para ${version}` +
    (igual ? '' : ` (publicado: ${pkg.version} — pode levar alguns minutos)`))
} catch {
  console.log('\n  · não consegui consultar o resolvedor de versão')
}

console.log()
process.exit(falhas ? 1 : 0)
