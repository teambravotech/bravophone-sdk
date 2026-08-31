// Exercita o ímã de largura da janela (js/bravophone-janela.js).
//
// POR QUE EXISTE: a janela da extensão tem três larguras que significam alguma
// coisa — 380 (só o discador), 640 (com a coluna de recentes inteira) e 920
// (com "sua conexão" aberta). Qualquer outra corta algo ao meio. O bundle já
// aplica essas larguras quando o próprio estado muda; o arrasto da borda
// parava em qualquer lugar e ninguém corrigia.
//
// O QUE ESTE TESTE SEGURA: que o ímã pega perto e solta longe, que ele não se
// realimenta, e que as três larguras continuam sendo as do bundle.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = await readFile(join(ROOT, 'host/js/bravophone-janela.js'), 'utf8')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const espera = (ms) => new Promise((r) => setTimeout(r, ms))

function montarAmbiente({ sdk = false, semWindows = false, largura = 640 } = {}) {
  const updates = []
  const winLis = {}
  const janela = { id: 7 }

  const win = {
    outerWidth: largura,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout,
    document: {
      readyState: 'complete',
      documentElement: { clientWidth: largura },
      addEventListener() {}, removeEventListener() {},
    },
    chrome: {
      runtime: { id: sdk ? 'bravophone-embed' : 'hilemigihmhidccebfodjmockngdlgmk', lastError: null },
      windows: semWindows ? {} : {
        getCurrent: (o, cb) => cb(janela),
        update: (id, props, cb) => { updates.push({ id, ...props }); cb && cb() },
      },
    },
    addEventListener: (t, fn) => { (winLis[t] = winLis[t] || []).push(fn) },
    removeEventListener() {},
  }
  win.window = win

  vm.createContext(win)
  vm.runInContext(FONTE, win)
  return { win, updates, winLis, redimensionar: (w) => { win.outerWidth = w
    ;(winLis.resize || []).forEach((fn) => fn()) } }
}

// --- os testes -------------------------------------------------------------

console.log('\njanela — as larguras são as do bundle:')
{
  // Se o bundle mudar CN/kN/_N e este arquivo não, o ímã passa a encaixar em
  // tamanhos que cortam algo — o oposto do que ele existe para fazer.
  const bundle = await readFile(resolve(ROOT, '..', 'Bravophone', 'popup.js'), 'utf8')
  for (const [nome, valor] of [['CN', 380], ['kN', 640], ['_N', 920]]) {
    check(`${nome} continua ${valor} no bundle`,
      new RegExp(`\\b${nome}=${valor}\\b`).test(bundle))
  }
  check('e o arquivo usa exatamente essas três',
    /LARGURAS = \[380, 640, 920\]/.test(FONTE))
}

console.log('\njanela — o ímã pega perto:')
{
  const a = montarAmbiente()
  a.redimensionar(600)
  await espera(340)
  check('600 encaixa em 640', a.updates.length === 1 && a.updates[0].width === 640,
    JSON.stringify(a.updates))

  const b = montarAmbiente()
  b.redimensionar(870)
  await espera(340)
  check('870 encaixa em 920', b.updates[0]?.width === 920, JSON.stringify(b.updates))

  const c = montarAmbiente()
  c.redimensionar(420)
  await espera(340)
  check('420 encaixa em 380', c.updates[0]?.width === 380, JSON.stringify(c.updates))
}

console.log('\njanela — e solta longe:')
{
  // No vão entre 380 e 640 a intenção é de um tamanho próprio; brigar com isso
  // seria pior que não fazer nada.
  const a = montarAmbiente()
  a.redimensionar(510)
  await espera(340)
  check('510 fica onde está', a.updates.length === 0, JSON.stringify(a.updates))

  const b = montarAmbiente()
  b.redimensionar(1400)
  await espera(340)
  check('1400 também', b.updates.length === 0, JSON.stringify(b.updates))

  const c = montarAmbiente()
  c.redimensionar(640)
  await espera(340)
  check('já encaixada não é reencaixada', c.updates.length === 0, JSON.stringify(c.updates))
}

console.log('\njanela — só ao soltar, e sem se realimentar:')
{
  const a = montarAmbiente()
  // Arrasto: vários resizes seguidos antes de soltar.
  for (const w of [600, 610, 620, 615]) { a.redimensionar(w); await espera(40) }
  check('durante o arrasto não encaixa', a.updates.length === 0, JSON.stringify(a.updates))
  await espera(340)
  check('encaixa uma vez ao soltar', a.updates.length === 1, JSON.stringify(a.updates))

  // O próprio encaixe dispara um resize; sem carência ele se realimentaria.
  a.redimensionar(640)
  await espera(340)
  check('o resize do próprio encaixe é ignorado', a.updates.length === 1,
    JSON.stringify(a.updates))
}

console.log('\njanela — onde não há janela, não faz nada:')
{
  // No SDK o webphone é um iframe: mexer no tamanho é decisão do site.
  const a = montarAmbiente({ sdk: true })
  check('no SDK nem registra o listener', !a.winLis.resize)

  const b = montarAmbiente({ semWindows: true })
  check('sem chrome.windows também não', !b.winLis.resize)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
