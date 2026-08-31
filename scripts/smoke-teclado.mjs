// Emula a digitação no teclado físico contra o guest-bridge real.
//
// POR QUE EXISTE: digitar não funcionava sem ramal. O bundle tem um listener
// de teclado, mas ele é registrado dentro de
// `this.extension && ... this.addListenerToKeyboard()` — sem `extension` ele
// nunca passa a existir, e só as teclas na tela respondem.
//
// POR QUE POR CLIQUE: a digitação é encaminhada clicando nos botões do
// dialpad, não pelo emitter do app. O emitter é uma variável de módulo
// devolvida pelo `setup()`, e esta é uma build de PRODUÇÃO do Vue: medido no
// navegador, `app._instance` é `false` e não há um único elemento com
// `__vueParentComponent`, então não existe caminho de API até ele.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

/** DOM mínimo: só o que o guest-bridge toca. */
function montarAmbiente({ aba = 'keypad', comRamal = false, comKeypad = true } = {}) {
  const listeners = {}
  const cliques = []

  const criarBotao = (texto, titulo) => ({
    tagName: 'BUTTON', textContent: texto, disabled: false,
    getAttribute: (a) => (a === 'title' ? (titulo || null) : null),
    setAttribute() {},
    click: () => cliques.push(texto || titulo),
    closest() { return this },
  })

  // Teclado como o bundle renderiza: o botão mostra o dígito e, às vezes, as
  // letras ("2ABC") — daí a comparação pelo primeiro caractere.
  const teclas = ['1', '2ABC', '3DEF', '4GHI', '5JKL', '6MNO',
                  '7PQRS', '8TUV', '9WXYZ', '*', '0+', '#'].map((t) => criarBotao(t))
  const acoes = [criarBotao('', 'Ligar'), criarBotao('', 'Apagar'), criarBotao('', 'Limpar')]
  const keypad = { querySelectorAll: () => teclas }

  const store = {
    state: {
      currentTab: aba,
      isLogged: true,
      extension: comRamal ? { username: '1001', password: 'x' } : null,
    },
    commit() {}, subscribe() {},
  }

  // Build de produção: sem _instance e sem __vueParentComponent, exatamente
  // como foi medido. Só o $store é alcançável.
  const appEl = {
    __vue_app__: {
      _context: { provides: { s: store }, config: { globalProperties: { $store: store } } },
      config: { globalProperties: { $store: store } },
    },
    style: {},
  }

  const doc = {
    getElementById: (id) => (id === 'app' ? appEl : null),
    querySelector: (sel) => (sel === '.keypad' ? (comKeypad ? keypad : null) : null),
    querySelectorAll: (sel) => (sel === 'button[title]' ? acoes : []),
    createElement: () => ({
      style: {}, setAttribute() {}, appendChild() {}, remove() {},
      querySelector: () => ({ textContent: '', onclick: null }),
      classList: { add() {}, remove() {}, toggle() {} },
      animate() {},
    }),
    addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
    removeEventListener() {},
    head: { appendChild() {} },
    body: { appendChild() {}, style: {} },
    visibilityState: 'visible',
    readyState: 'complete',
    baseURI: 'http://host/',
  }

  const win = {
    document: doc,
    addEventListener() {}, removeEventListener() {},
    location: { href: 'http://host/', search: '' },
    navigator: { language: 'pt-BR' },
    parent: { postMessage() {} },
    __bpParentOrigin: 'http://cliente',
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    Promise, Object, Array, String, JSON, Date, Math, RegExp, Error,
    URLSearchParams, MutationObserver: class { observe() {} disconnect() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    chrome: {
      i18n: {
        getMessage: (k) => ({
          webphoneCallMake: 'Ligar',
          webphoneDialBackspace: 'Apagar',
          webphoneDialClear: 'Limpar',
        }[k] || ''),
      },
      storage: { local: { set: (o, cb) => cb && cb(), get: (k, cb) => cb && cb({}), remove: (k, cb) => cb && cb() } },
      runtime: { onMessage: { addListener() {}, hasListeners: () => true }, sendMessage: (m, cb) => cb && cb() },
    },
  }
  win.window = win
  win.self = win

  return { win, listeners, cliques, store }
}

/** Dispara um keydown como o navegador faria. */
function teclar(listeners, key, extra = {}) {
  const ev = {
    key,
    target: extra.target || { tagName: 'DIV', isContentEditable: false },
    ctrlKey: false, metaKey: false, altKey: false,
    preventDefault() {}, stopPropagation() {},
    ...extra,
  }
  ;(listeners.keydown || []).forEach((fn) => fn(ev))
  return ev
}

const fonte = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')

async function comAmbiente(opts, acao) {
  const amb = montarAmbiente(opts)
  vm.createContext(amb.win)
  vm.runInContext(fonte, amb.win)
  await new Promise((r) => setTimeout(r, 300))
  return acao(amb)
}

console.log('\nteclado — a tecla clica o botão correspondente:')
await comAmbiente({}, ({ listeners, cliques }) => {
  check('registrou o listener de keydown', (listeners.keydown || []).length > 0)
  for (const [tecla, rotulo] of [['1', '1'], ['2', '2ABC'], ['9', '9WXYZ'], ['0', '0+'], ['*', '*'], ['#', '#']]) {
    cliques.length = 0
    teclar(listeners, tecla)
    check(`"${tecla}" clica o botão "${rotulo}"`, cliques.includes(rotulo), JSON.stringify(cliques))
  }
})

console.log('\nteclado — teclas de controle (sem ramal, que é quando isto vale):')
await comAmbiente({ comRamal: false }, ({ listeners, cliques }) => {
  cliques.length = 0
  teclar(listeners, 'Backspace')
  check('Backspace aciona apagar', cliques.includes('Apagar'), JSON.stringify(cliques))

  cliques.length = 0
  teclar(listeners, 'Enter')
  check('Enter aciona ligar', cliques.includes('Ligar'), JSON.stringify(cliques))

  cliques.length = 0
  teclar(listeners, 'Escape')
  check('Escape aciona limpar', cliques.includes('Limpar'), JSON.stringify(cliques))
})

console.log('\nteclado — COM ramal quem digita é o bundle:')
await comAmbiente({ comRamal: true }, ({ listeners, cliques }) => {
  // O bundle só registra o próprio listener quando há extension:
  //     this.extension && ... this.addListenerToKeyboard() ...
  // Insistir aqui fazia cada tecla entrar duas vezes — "2" virava "22" na
  // página hospedada, onde o bravophone-input.js não era carregado e mais
  // ninguém desligava este atalho.
  for (const tecla of ['1', '7', 'Backspace', 'Enter', 'Escape']) {
    cliques.length = 0
    teclar(listeners, tecla)
    check(`"${tecla}" não é duplicada`, cliques.length === 0, JSON.stringify(cliques))
  }
})

console.log('\nteclado — sem ramal, digitar continua funcionando:')
await comAmbiente({ comRamal: false }, ({ listeners, cliques }) => {
  // É o que leva o usuário até o clique em Ligar, onde o aviso explica o
  // motivo — em vez de um campo morto.
  cliques.length = 0
  teclar(listeners, '4')
  check('dígitos funcionam sem ramal', cliques.includes('4GHI'), JSON.stringify(cliques))
})

console.log('\nteclado — o que NÃO deve capturar:')
await comAmbiente({}, ({ listeners, cliques }) => {
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    cliques.length = 0
    teclar(listeners, '5', { target: { tagName: tag, isContentEditable: false } })
    check(`ignora digitação dentro de <${tag.toLowerCase()}>`, cliques.length === 0)
  }
  cliques.length = 0
  teclar(listeners, '5', { target: { tagName: 'DIV', isContentEditable: true } })
  check('ignora contenteditable', cliques.length === 0)

  cliques.length = 0
  teclar(listeners, '5', { ctrlKey: true })
  check('ignora atalho com Ctrl', cliques.length === 0)

  cliques.length = 0
  teclar(listeners, 'F5')
  check('ignora teclas sem correspondência', cliques.length === 0)
})

console.log('\nteclado — respeita o contexto:')
await comAmbiente({ aba: 'history' }, ({ listeners, cliques }) => {
  cliques.length = 0
  teclar(listeners, '7')
  check('não digita fora da aba do teclado', cliques.length === 0, JSON.stringify(cliques))
})
await comAmbiente({ comKeypad: false }, ({ listeners, cliques }) => {
  // Antes do teclado renderizar, a tecla passa adiante em vez de sumir.
  cliques.length = 0
  teclar(listeners, '3')
  check('sem o keypad no DOM, não quebra', cliques.length === 0)
})

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
