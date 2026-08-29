#!/usr/bin/env node
/**
 * audit-theme.mjs — encontra texto invisível no tema escuro.
 *
 * O `dark-theme.css` da extensão é um override manual de classes Tailwind: uma
 * allowlist escrita à mão. Toda classe que ficou de fora mantém a cor original
 * do Tailwind — pensada para fundo branco — e, sobre o fundo escuro, some.
 *
 * Este script cruza as classes que o bundle realmente usa com as que o tema
 * cobre, e calcula o contraste WCAG do que sobrou. Rode depois de cada
 * `npm run sync`: quando a extensão ganhar uma tela nova, o texto invisível
 * aparece aqui em vez de aparecer para o usuário.
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOST = join(ROOT, 'host')

/** Paleta Tailwind v3 nos tons que o bundle usa. */
const TW = {
  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937',
  'gray-900': '#111827',
  'slate-100': '#f1f5f9', 'slate-200': '#e2e8f0',
  'blue-50': '#eff6ff', 'blue-200': '#bfdbfe', 'blue-400': '#60a5fa',
  'blue-500': '#3b82f6', 'blue-600': '#2563eb', 'blue-700': '#1d4ed8',
  'red-400': '#f87171', 'red-500': '#ef4444', 'red-600': '#dc2626',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e',
  'green-600': '#16a34a', 'green-700': '#15803d',
  'amber-600': '#d97706', 'amber-700': '#b45309',
  'yellow-400': '#facc15', 'yellow-500': '#eab308',
  black: '#000000', white: '#ffffff',
}

/** Fundo predominante do tema escuro (--bp-panel). */
const BG = '#171b28'

const srgb = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b)
}
function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}

async function main() {
  const bundle = join(HOST, 'popup.js')
  if (!existsSync(bundle)) {
    console.error('✗ host/popup.js não existe. Rode `npm run sync` antes.')
    process.exit(1)
  }

  const js = await readFile(bundle, 'utf8')
  let css = await readFile(join(HOST, 'css', 'dark-theme.css'), 'utf8')
  const fixes = join(HOST, 'styles', 'theme-fixes.css')
  if (existsSync(fixes)) css += '\n' + (await readFile(fixes, 'utf8'))

  // Classes de cor que o bundle usa, com quantas vezes.
  const used = new Map()
  const re = /\b(text|bg|border|divide|placeholder)-((?:gray|slate|zinc|neutral|stone|blue|red|green|amber|yellow|indigo|purple)-\d{2,3}|black|white)\b/g
  for (const m of js.matchAll(re)) {
    const key = `${m[1]}-${m[2]}`
    used.set(key, (used.get(key) || 0) + 1)
  }

  const findings = []
  for (const [cls, count] of used) {
    const [prop, ...rest] = cls.split('-')
    const tone = rest.join('-')
    const hex = TW[tone]
    if (!hex) continue                       // tom fora da tabela: ignora
    if (css.includes(`.${cls}`)) continue    // já coberto pelo tema

    // Só texto e fundo determinam legibilidade; borda é estética.
    if (prop === 'text') {
      const ratio = contrast(hex, BG)
      if (ratio < 3) {
        findings.push({ cls, count, hex, ratio, kind: 'texto quase invisível' })
      }
    } else if (prop === 'bg') {
      // Fundo claro não convertido + texto claro herdado = invisível.
      if (luminance(hex) > 0.55) {
        findings.push({ cls, count, hex, ratio: null, kind: 'fundo claro não convertido' })
      }
    }
  }

  findings.sort((a, b) => (a.ratio ?? 0) - (b.ratio ?? 0) || b.count - a.count)

  console.log(`\nAuditoria do tema escuro  (fundo de referência ${BG})\n`)
  if (!findings.length) {
    console.log('  ✓ nenhuma classe de cor usada pelo bundle ficou sem cobertura\n')
    return
  }

  for (const f of findings) {
    const r = f.ratio === null ? '  —  ' : `${f.ratio.toFixed(2)}:1`
    console.log(`  ✗ ${f.cls.padEnd(18)} ${f.hex}  ${r}  ${String(f.count).padStart(3)}×  ${f.kind}`)
  }
  console.log(`\n  ${findings.length} classes sem cobertura. WCAG AA pede 4.5:1 para texto normal.\n`)
  process.exitCode = 1
}

main().catch((err) => {
  console.error('✗ Falhou:', err)
  process.exit(1)
})
