// A ponte sobrevive a payload não clonável — nos dois sentidos.
//
// POR QUE EXISTE: um bug real em 0.8.3. O postMessage copia tudo pelo
// algoritmo de clonagem estruturada, e ele recusa função, nó do DOM,
// MediaStream, sessão SIP crua e QUALQUER Proxy — que é o que todo estado
// reativo do Vue é. Um campo desses lança DataCloneError e a mensagem INTEIRA
// se perde, calada: o integrador via "[bp-bridge] postMessage falhou:
// DataCloneError" e, 15 s depois, "timeout no comando status". Evento de
// chamada nenhum chegava.
//
// Nenhum teste pegou isso porque todos os ambientes falsos usavam
// `postMessage: (m) => respostas.push(m)` — um push não clona nada, então
// qualquer payload passava. Aqui o postMessage falso CLONA DE VERDADE
// (structuredClone, o mesmo algoritmo do navegador) e estoura igual ao Chrome.
// É isso que faz este arquivo valer: o que ele verifica não dá para verificar
// com um array.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')
const { sanear, postar } = await import('../src/clonavel.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms))

/** Objeto de plataforma falso: o que decide é a etiqueta, como no navegador. */
const plataforma = (tag, campos = {}) => ({ ...campos, [Symbol.toStringTag]: tag })

/** O mesmo que o Vue entrega: dado simples atrás de um Proxy. */
const reativo = (alvo) => new Proxy(alvo, {})

/**
 * Uma janela que recebe postMessage como o navegador: clonando.
 *
 * `recusar` simula o caso extremo — a mensagem não sai nem saneada. Serve para
 * provar que o guest ainda responde alguma coisa em vez de deixar o host
 * esperando o timeout.
 */
function janelaQueClona({ recusar = () => false } = {}) {
  const recebidas = []
  return {
    recebidas,
    postMessage(msg) {
      if (recusar(msg)) {
        const err = new Error('#<Object> could not be cloned.')
        err.name = 'DataCloneError'
        throw err
      }
      // structuredClone estoura DataCloneError exatamente onde o Chrome estoura.
      recebidas.push(structuredClone(msg))
    },
  }
}

// --- lado do iframe (host/shim/guest-bridge.js) -----------------------------

const I18N = { webphoneCallHangup: 'Desligar', globalClear: 'Limpar' }

function montarGuest({ estado = {}, rotasReativas = false, recusar } = {}) {
  const pai = janelaQueClona({ recusar })
  const winLis = {}
  const avisos = []
  const store = {
    state: { isLogged: true, ...estado },
    commit() {},
    inscritos: [],
    subscribe(fn) { this.inscritos.push(fn) },
    mutar(campos) {
      Object.assign(this.state, campos)
      this.inscritos.forEach((fn) => fn())
    },
  }
  const appEl = { __vue_app__: { config: { globalProperties: { $store: store } } }, style: {} }

  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    baseURI: 'http://host/',
    head: { appendChild() {} },
    body: { appendChild() {}, style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {} } },
    documentElement: { setPointerCapture() {}, releasePointerCapture() {} },
    getElementById: (id) => (id === 'app' ? appEl : null),
    createElement: () => ({
      style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, appendChild() {},
      remove() {}, classList: { add() {}, remove() {}, toggle() {} },
      querySelector: () => ({ textContent: '', onclick: null }),
      animate() {},
    }),
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  }

  const win = {
    document: doc,
    location: { href: 'http://host/', search: '', origin: 'http://host' },
    navigator: { language: 'pt-BR', mediaDevices: { addEventListener() {} } },
    parent: pai,
    __bpParentOrigin: 'http://cliente',
    // O campo de discagem publica este gancho quando está montado.
    __bpInputPreencher: () => true,
    BravoPhoneRoutes: {
      whenReady: () => Promise.resolve(),
      // Com rotasReativas, o seletor devolve o que um app Vue devolveria: a
      // lista e cada item atrás de um Proxy.
      getRoutes: () => (rotasReativas
        ? reativo([reativo({ id: 'r1', name: 'Tronco A', prefix: '0' })])
        : [{ id: 'r1', name: 'Tronco A', prefix: '0' }]),
      getSelected: () => (rotasReativas
        ? reativo({ id: 'r1', name: 'Tronco A', prefix: '0' })
        : { id: 'r1', name: 'Tronco A', prefix: '0' }),
      getPrefix: () => '0',
      select() {},
    },
    console: {
      log() {}, info() {},
      warn: (...a) => avisos.push(a.join(' ')),
      error: (...a) => avisos.push(a.join(' ')),
    },
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    chrome: {
      i18n: { getMessage: (k) => I18N[k] || '' },
      storage: { local: { set: (o, cb) => cb && cb(), get: (k, cb) => cb && cb({}), remove: (k, cb) => cb && cb() } },
      runtime: {
        id: 'bravophone-embed',
        onMessage: { addListener() {}, hasListeners: () => true },
        sendMessage: (m, cb) => cb && cb(),
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
  return { win, store, pai, winLis, avisos }
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
    const r = amb.pai.recebidas.find((m) => m.type === 'reply' && m.id === id)
    if (r) return r
    await espera(10)
  }
  return null
}

const eventos = (amb, nome) =>
  amb.pai.recebidas.filter((m) => m.type === 'event' && m.name === nome)

console.log('\nponte — o ready atravessa a clonagem:')
{
  const a = montarGuest()
  await espera()
  check('o host recebe o ready', a.pai.recebidas.some((m) => m.type === 'ready'))
  check('e nada falhou no caminho', a.avisos.length === 0, a.avisos.join(' | '))
}

console.log('\nponte — evento de chamada com estado reativo ainda chega:')
{
  // O estado da chamada vem do store do bundle. Num app Vue 3 ele é reativo:
  // ler `callDisplay` pode devolver um Proxy, e era isso que matava o evento.
  const a = montarGuest({ estado: { callActive: false } })
  await espera(200)
  check('o vigia do store está de pé', a.store.inscritos.length > 0, a.store.inscritos.length)
  // O vigia emite TRANSIÇÃO: o primeiro tick só registra o estado inicial.
  a.store.mutar({})
  a.store.mutar({
    callActive: true,
    callPhase: 'ringing',
    callIsIncoming: true,
    callDisplay: reativo({ name: 'Maria', number: '1140041234' }),
  })
  await espera(200)

  const chegou = eventos(a, 'call:incoming')
  check('call:incoming chega ao host', chegou.length === 1, chegou.length)
  check('e o número vem como texto, não objeto',
    chegou[0] && chegou[0].payload.number === '1140041234',
    chegou[0] && JSON.stringify(chegou[0].payload))
  check('com a direção certa',
    chegou[0] && chegou[0].payload.direction === 'inbound')
}

console.log('\nponte — resposta de comando com objeto reativo ainda chega:')
{
  const a = montarGuest({ rotasReativas: true })
  await espera()
  const r = await comando(a, 'routes')
  check('routes responde (não cai no timeout)', !!r)
  check('sem erro', r && !r.error, r && r.error)
  check('e a lista atravessou como dado',
    !!r && !r.error && Array.isArray(r.payload.routes) && r.payload.routes[0].id === 'r1',
    r && JSON.stringify(r.payload))
  check('o aviso diz o que foi descartado',
    a.avisos.some((m) => /não clonável/.test(m)), a.avisos.join(' | '))
}

console.log('\nponte — sem clonagem possível, responde erro em vez de silêncio:')
{
  // Caso extremo: nem a cópia saneada sai. O host PRECISA de uma mensagem —
  // sem ela o integrador só descobre 15 s depois, como "timeout", que é o
  // sintoma errado da causa errada.
  const a = montarGuest({ recusar: (m) => JSON.stringify(m || {}).includes('5551234') })
  await espera()
  const r = await comando(a, 'setDial', { number: '5551234' })
  check('ainda vem uma resposta', !!r)
  check('e ela é um erro nomeado',
    !!r && /não pôde ser serializada/.test(r.error || ''), r && JSON.stringify(r))
}

console.log('\nponte — origem errada não vira aviso de clonagem:')
{
  // SecurityError é configuração: sanear não conserta e não deve mascarar.
  const a = montarGuest()
  await espera()
  a.pai.recebidas.length = 0
  a.avisos.length = 0
  a.win.parent.postMessage = () => {
    const err = new Error('Failed to execute postMessage: target origin mismatch')
    err.name = 'SecurityError'
    throw err
  }
  const r = await comando(a, 'ping')
  check('não responde (a mensagem realmente não sai)', r === null)
  check('e o erro registrado é o de verdade',
    a.avisos.some((m) => /SecurityError|postMessage falhou/.test(m)) &&
    !a.avisos.some((m) => /não clonável/.test(m)), a.avisos.join(' | '))
}

// --- o saneador (src/clonavel.js) -------------------------------------------

console.log('\nsanear — o que fica e o que sai:')
{
  const s = sanear({
    numero: '1140041234', tocando: true, tentativas: 3, nada: null,
    cb: () => {},
    stream: plataforma('MediaStream'),
    no: plataforma('HTMLDivElement'),
    sessao: plataforma('RTCPeerConnection', { id: 'rtc-1' }),
    quando: new Date(1700000000000),
    erro: new TypeError('fora de hora'),
  })
  check('primitivos ficam', s.numero === '1140041234' && s.tocando === true && s.tentativas === 3)
  check('null fica (é clonável)', 'nada' in s && s.nada === null)
  check('função sai', !('cb' in s))
  check('MediaStream sai', !('stream' in s))
  check('nó do DOM sai', !('no' in s))
  check('objeto de plataforma sai inteiro, não só por dentro', !('sessao' in s))
  check('Date fica', s.quando instanceof Date && s.quando.getTime() === 1700000000000)
  check('Error vira nome + mensagem',
    s.erro && s.erro.name === 'TypeError' && s.erro.message === 'fora de hora',
    JSON.stringify(s.erro))
  check('o resultado é clonável de verdade', (() => {
    try { structuredClone(s); return true } catch { return false }
  })())
}

console.log('\nsanear — Proxy reativo vira dado:')
{
  const alvo = { id: 7, itens: reativo([reativo({ n: 1 }), reativo({ n: 2 })]) }
  const s = sanear(reativo(alvo))
  check('o Proxy de fora virou objeto comum', s.id === 7)
  check('e o de dentro também', s.itens.length === 2 && s.itens[1].n === 2, JSON.stringify(s))
  check('o resultado atravessa o postMessage', (() => {
    try { structuredClone(s); return true } catch { return false }
  })())
}

console.log('\nsanear — estrutura hostil não derruba a mensagem:')
{
  const ciclo = { nome: 'a' }
  ciclo.eu = ciclo
  const s1 = sanear({ ciclo })
  check('ciclo é cortado, o resto fica', s1.ciclo.nome === 'a' && !('eu' in s1.ciclo),
    JSON.stringify(s1))

  // O mesmo objeto em dois ramos NÃO é ciclo: os dois precisam ir.
  const comum = { v: 1 }
  const s2 = sanear({ a: comum, b: comum })
  check('objeto repetido em ramos diferentes vai nos dois',
    s2.a && s2.b && s2.a.v === 1 && s2.b.v === 1, JSON.stringify(s2))

  const s3 = sanear({ get bomba() { throw new Error('getter explodiu') }, ok: 1 })
  check('getter que estoura perde só o campo', s3.ok === 1 && !('bomba' in s3), JSON.stringify(s3))

  let fundo = { fim: true }
  for (let i = 0; i < 40; i++) fundo = { dentro: fundo }
  const s4 = sanear(fundo)
  check('profundidade absurda é cortada sem estourar a pilha',
    !!s4 && JSON.stringify(s4).length < 400, JSON.stringify(s4).length)

  const s5 = sanear([1, () => {}, 'x', plataforma('MediaStream')])
  check('em lista, o item descartado não desalinha os outros',
    s5.length === 4 && s5[0] === 1 && s5[2] === 'x' && s5[1] === undefined,
    JSON.stringify(s5))
}

console.log('\npostar — devolve se a mensagem saiu:')
{
  const boa = janelaQueClona()
  check('mensagem comum: true', postar(boa, { type: 'x', n: 1 }, 'http://cliente') === true)

  const reativaFoi = postar(boa, { type: 'command', payload: reativo({ a: 1 }) }, 'http://cliente')
  check('payload reativo: sai saneado e devolve true', reativaFoi === true)
  check('e o que chegou é o dado', boa.recebidas.at(-1).payload.a === 1,
    JSON.stringify(boa.recebidas.at(-1)))

  check('sem janela (contentWindow nulo): false', postar(null, { type: 'x' }, 'http://cliente') === false)

  const recusa = janelaQueClona({ recusar: () => true })
  check('recusa sempre: false', postar(recusa, { type: 'x' }, 'http://cliente') === false)
}

// --- lado do host (src/bridge.js) -------------------------------------------

console.log('\nhost — o comando não fica pendurado quando não dá para enviar:')
{
  globalThis.window = globalThis.window || { addEventListener() {}, removeEventListener() {} }
  const lis = []
  globalThis.window = { addEventListener: (t, fn) => lis.push(fn), removeEventListener() {} }
  const { createBridge } = await import('../src/bridge.js')

  const guest = janelaQueClona()
  const frame = { contentWindow: guest }
  const ponte = createBridge({ frame, origin: 'http://webphone', onEvent() {} })

  // O ready libera a fila — é o que o guest manda ao montar.
  lis.forEach((fn) => fn({
    origin: 'http://webphone', source: guest,
    data: { protocol: 'bravophone/v1', type: 'ready', payload: {} },
  }))

  // Sessão reativa: é assim que ela chega de um CRM feito em Vue.
  const p = ponte.call('auth', { session: reativo({ vxToken: 'vx-1', extension: reativo({ username: '2003' }) }) })
  const enviada = guest.recebidas.find((m) => m.command === 'auth')
  check('o auth saiu mesmo com sessão reativa', !!enviada)
  check('e o token atravessou', enviada && enviada.payload.session.vxToken === 'vx-1',
    JSON.stringify(enviada))
  check('com o ramal de dentro também',
    enviada && enviada.payload.session.extension.username === '2003')

  // Responde para não deixar promessa pendente no processo.
  lis.forEach((fn) => fn({
    origin: 'http://webphone', source: guest,
    data: { protocol: 'bravophone/v1', type: 'reply', id: enviada.id, payload: { ok: true } },
  }))
  check('e a resposta resolve', (await p).ok === true)

  // Iframe que saiu do DOM: contentWindow é null. Antes isso esperava os 15 s
  // do timeout para dizer o que já se sabia na hora do envio.
  const morto = createBridge({ frame: { contentWindow: null }, origin: 'http://webphone', onEvent() {} })
  lis.forEach((fn) => fn({
    origin: 'http://webphone', source: null,
    data: { protocol: 'bravophone/v1', type: 'ready', payload: {} },
  }))
  let erro = null
  const inicio = Date.now()
  await morto.call('status', {}, { timeout: 15000 }).catch((e) => { erro = e.message })
  check('rejeita na hora, sem esperar o timeout', Date.now() - inicio < 1000, Date.now() - inicio)
  check('e diz que não pôde enviar', /não pôde ser enviado/.test(erro || ''), erro)
  morto.destroy()
  ponte.destroy()
}

// --- a armadilha que deixou isso passar -------------------------------------

console.log('\nregressão — nenhum teste pode fingir que postMessage não clona:')
{
  // Este é o guardião do guardião: se um ambiente falso voltar a empurrar a
  // mensagem num array sem clonar, o bug de 0.8.3 volta a ser invisível.
  check('este arquivo usa structuredClone no postMessage falso',
    /structuredClone\(msg\)/.test(await readFile(join(ROOT, 'scripts/smoke-clonavel.mjs'), 'utf8')))
  check('o guest-bridge tenta de novo saneado',
    /postMessage\(sanear\(corpo\)/.test(FONTE))
  check('e o post do guest devolve se a mensagem saiu',
    /if \(post\(\{ type: 'reply'/.test(FONTE))
}

console.log(`\n${fail === 0 ? '✓' : '✗'} clonável: ${pass} ok, ${fail} falhas\n`)
process.exit(fail === 0 ? 0 : 1)
