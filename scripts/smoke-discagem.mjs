// Exercita o número que `Bravophone.call()` entrega ao funil do bundle.
//
// POR QUE EXISTE: "não disca número com DDD 55". O 55 de Santa Maria (RS) é
// também o DDI do Brasil, e o watcher de callNumber do popup.js decide quem
// é quem só pelo começo do texto:
//
//     e.length>4 && !e.startsWith("+") &&
//       (e = e.startsWith(String(this.defaultCallingCode())) ? `+${e}`
//                                                            : `+${this.defaultCallingCode()}${e}`)
//
// "55999998888" (DDD 55 + celular) vira "+55999998888": DDD 99 com 7
// dígitos. A libphonenumber (metadados completos, os do bundle) diz que não
// é válido, isValidNumberCall fica false e makeOrAnswerCall sai calado em
// "blocked: isValidNumberCall is false, doing nothing". Nenhum erro chega a
// ninguém — a ligação simplesmente não acontece.
//
// O bundle vem da extensão e não é editado aqui. O que a ponte faz é não
// entregar a ele um número ambíguo: com 10 ou 11 dígitos e começando com 55,
// é DDD 55 (55 + 8 ou 9 dígitos nunca é um número brasileiro com DDI), então
// sai com o DDI na frente, "5555999998888", que o watcher lê certo. Com 12 ou
// 13 dígitos, ou com "+", o 55 já é DDI e nada muda.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/**
 * A regra do bundle, copiada do watcher de callNumber (popup.js da extensão,
 * v2.6.16): é por ela que o número entregue vira o E.164 que a libphonenumber
 * valida. O bundle antes acumula callNumber com dL(), que deixa só 0-9+*#.
 */
function e164DoBundle(phone, codigo = '55') {
  let e = String(phone).replace(/[^0-9+*#]/g, '')
  if (e.length > 4 && !e.startsWith('+')) {
    e = e.startsWith(codigo) ? `+${e}` : `+${codigo}${e}`
  }
  return e
}

function montarAmbiente({ paisPadrao } = {}) {
  const respostas = []
  const enviadas = []
  const winLis = {}
  const store = {
    state: { isLogged: true, extension: { username: '1001', password: 's' } },
    commit() {}, subscribe() {},
  }
  const appEl = { __vue_app__: { config: { globalProperties: { $store: store } } }, style: {} }
  const no = () => ({
    style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, appendChild() {},
    remove() {}, classList: { add() {}, remove() {}, toggle() {} },
    querySelector: () => ({ textContent: '', onclick: null }),
    animate() {},
  })
  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    baseURI: 'http://host/',
    head: { appendChild() {} },
    body: { appendChild() {}, style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {} } },
    getElementById: (id) => (id === 'app' ? appEl : null),
    createElement: no,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  }
  const sync = paisPadrao ? { bravophoneDefaultCountry: paisPadrao } : {}
  const win = {
    document: doc,
    location: { href: 'http://host/', search: '', origin: 'http://host' },
    navigator: { language: 'pt-BR', mediaDevices: { addEventListener() {} } },
    parent: { postMessage: (m) => respostas.push(m) },
    __bpParentOrigin: 'http://cliente',
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    chrome: {
      i18n: { getMessage: () => '' },
      storage: {
        local: { set: (o, cb) => cb && cb(), get: (k, cb) => cb && cb({}), remove: (k, cb) => cb && cb() },
        // Como no shim: o callback volta na hora.
        sync: {
          get: (k, cb) => {
            const out = {}
            ;[].concat(k).forEach((c) => { if (c in sync) out[c] = sync[c] })
            if (cb) cb(out)
            return Promise.resolve(out)
          },
        },
      },
      runtime: {
        id: 'bravophone-embed',
        onMessage: { addListener() {}, hasListeners: () => true },
        sendMessage: (m, cb) => { enviadas.push(m); if (cb) cb() },
        getManifest: () => ({ version: '0' }),
      },
    },
    addEventListener: (t, fn) => { (winLis[t] = winLis[t] || []).push(fn) },
    removeEventListener() {},
  }
  win.window = win
  win.self = win
  vm.createContext(win)
  vm.runInContext(FONTE, win)
  return { win, respostas, enviadas, winLis }
}

let proximoId = 1
async function comando(amb, nome, payload) {
  const id = 'c' + (proximoId++)
  const ev = {
    origin: 'http://cliente',
    source: amb.win.parent,
    data: { protocol: 'bravophone/v1', type: 'command', id, command: nome, payload },
  }
  ;(amb.winLis.message || []).forEach((fn) => fn(ev))
  for (let i = 0; i < 60; i++) {
    const r = amb.respostas.find((m) => m.type === 'reply' && m.id === id)
    if (r) {
      if (r.error) throw new Error(r.error)
      return r.payload
    }
    await espera(10)
  }
  throw new Error('sem resposta para ' + nome)
}

/** Disca pelo caminho do integrador e devolve o que chegou ao bundle. */
async function discar(numero, opcoes) {
  const a = montarAmbiente(opcoes)
  await espera()
  const r = await comando(a, 'call', { number: numero })
  const m = a.enviadas.find((x) => x.method === 'webphoneDialNow')
  return { resposta: r, phone: m && m.payload.phone }
}

// --- os testes -------------------------------------------------------------

console.log('\ndiscagem — DDD 55 sem DDI é número nacional:')
for (const [entrada, nacional] of [
  ['55999998888', '55999998888'],      // celular de Santa Maria
  ['5532221111', '5532221111'],        // fixo de Santa Maria
  ['(55) 99999-8888', '55999998888'],  // com máscara
  ['55 3222-1111', '5532221111'],
]) {
  const { resposta, phone } = await discar(entrada)
  const e164 = e164DoBundle(phone)
  // O que importa é o número que o bundle valida: +55, e o DDD 55 inteiro
  // depois dele. Antes da correção saía "+55999998888" (DDD 99).
  check(`${entrada} → o bundle lê +55 ${nacional}`, e164 === '+55' + nacional,
    `entregue ${phone} → ${e164}`)
  check(`${entrada} → e a resposta diz o que foi discado`,
    resposta && resposta.phone === phone, JSON.stringify(resposta))
}

console.log('\ndiscagem — com DDI, o 55 já é o do país e nada muda:')
for (const entrada of ['5555999998888', '555532221111', '+55 55 99999-8888', '+5555999998888',
                       '5511988887777', '551133334444']) {
  const { phone } = await discar(entrada)
  check(`${entrada} sai como veio`, phone === entrada, phone)
}

console.log('\ndiscagem — o resto continua intocado:')
for (const entrada of ['11999998888', '1132221111', '2011', '20110', '*55', '*5599']) {
  const { phone } = await discar(entrada)
  check(`${entrada} sai como veio`, phone === entrada, phone)
}

console.log('\ndiscagem — país padrão fora do Brasil não ganha 55:')
{
  // Com outro país padrão o bundle prefixa o DDI DELE, e 55 no começo não é
  // DDD 55 de ninguém. A ponte não pode decidir pelo Brasil.
  const { phone } = await discar('55999998888', { paisPadrao: 'PT' })
  check('55999998888 com Portugal sai como veio', phone === '55999998888', phone)
  const br = await discar('55999998888', { paisPadrao: 'BR' })
  check('e com Brasil explícito, ganha o DDI', e164DoBundle(br.phone) === '+5555999998888', br.phone)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
