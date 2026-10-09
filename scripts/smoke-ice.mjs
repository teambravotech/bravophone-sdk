// A negociação de mídia: candidatos ICE e os servidores do integrador.
//
// POR QUE EXISTE. Em 2026-10-09 uma chamada foi atendida, durou 42 s e ficou
// muda dos dois lados, sem um erro no console. O SIP tinha completado; o que
// faltou foi o navegador — uma extensão de VPN tinha ligado
// `webrtc.ip_handling_policy = disable_non_proxied_udp`, e com ela o Chrome
// não emite candidato ICE nenhum. A oferta sai sem `a=candidate`, o PABX não
// tem para onde mandar RTP, e nada nisso é visível pela sinalização.
//
// Duas respostas, as duas testadas aqui:
//   · a coleta terminar vazia vira aviso (`media:blocked` + faixa na janela),
//     em vez de silêncio;
//   · `iceServers` passa a ser configurável — o JsSIP cria a conexão com
//     `{iceServers: []}` fixo, então o único ponto de injeção é envolver o
//     construtor do RTCPeerConnection.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')
const { buildSrcdoc } = await import('../src/srcdoc.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

const STUN = [{ urls: 'stun:stun.exemplo.com:3478' }]

/** Um RTCPeerConnection de mentira, com os ganchos que a ponte usa. */
function fabricarPC() {
  const criadas = []
  class FalsaPC {
    constructor(cfg) {
      this.cfg = cfg
      this.iceGatheringState = 'new'
      this.localDescription = null
      this.lis = {}
      criadas.push(this)
    }
    addEventListener(tipo, fn) { (this.lis[tipo] = this.lis[tipo] || []).push(fn) }
    disparar(tipo, ev) { (this.lis[tipo] || []).forEach((fn) => fn(ev)) }

    /** O que o navegador faz ao terminar a coleta. */
    coletar({ candidatos = [], noSdp = true } = {}) {
      candidatos.forEach((c) => this.disparar('icecandidate', { candidate: { candidate: c } }))
      this.localDescription = {
        sdp: 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\nc=IN IP4 0.0.0.0\r\n' +
          (noSdp ? candidatos.map((c) => 'a=' + c + '\r\n').join('') : ''),
      }
      this.iceGatheringState = 'complete'
      this.disparar('icegatheringstatechange', {})
    }
  }
  FalsaPC.generateCertificate = () => Promise.resolve({ fake: true })
  FalsaPC.marcaEstatica = 42
  return { FalsaPC, criadas }
}

function montarAmbiente({ iceServers } = {}) {
  const respostas = []
  const winLis = {}
  const nosDoBody = []
  const { FalsaPC, criadas } = fabricarPC()

  // O vigia de chamada do guest-bridge reage a `subscribe` (uma mutation do
  // Vuex) e, como rede de segurança, a um setInterval. Aqui implementamos o
  // primeiro: é o caminho normal e não depende de relógio.
  const assinantes = []
  const store = {
    state: { callActive: false, callPhase: null, isLogged: true, extension: { username: '1001', password: 'x' } },
    commit() {}, subscribe(fn) { assinantes.push(fn) },
  }
  const notificar = () => assinantes.forEach((fn) => fn())
  const appEl = { __vue_app__: { config: { globalProperties: { $store: store } } }, style: {} }

  const criarEl = () => ({
    style: { setProperty() {}, removeProperty() {} },
    classList: { add() {}, remove() {}, toggle() {} },
    setAttribute() {}, appendChild() {}, remove() {}, animate() {},
    innerHTML: '', textContent: '',
    querySelector() { return { textContent: '', onclick: null } },
  })

  const doc = {
    readyState: 'complete', visibilityState: 'visible', baseURI: 'http://host/',
    head: { appendChild() {} },
    body: {
      appendChild: (n) => nosDoBody.push(n),
      style: { setProperty() {}, removeProperty() {} },
      classList: { add() {}, remove() {} },
    },
    getElementById: (id) => (id === 'app' ? appEl : null),
    createElement: (tag) => {
      const el = criarEl()
      el.tagName = String(tag || '').toUpperCase()
      return el
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  }

  const win = {
    document: doc,
    location: { href: 'http://host/', search: '', origin: 'http://host' },
    navigator: { language: 'pt-BR', mediaDevices: { addEventListener() {} } },
    parent: { postMessage: (m) => respostas.push(m) },
    __bpParentOrigin: 'http://cliente',
    RTCPeerConnection: FalsaPC,
    console: { log() {}, warn() {}, error() {}, info() {} },
    setTimeout, clearTimeout, setInterval: () => 0, clearInterval,
    MutationObserver: class { observe() {} disconnect() {} },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {}, length: 0, key: () => null },
    chrome: {
      i18n: { getMessage: () => '' },
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
  if (iceServers) win.__bpIceServers = iceServers
  win.window = win
  win.self = win

  vm.createContext(win)
  vm.runInContext(FONTE, win)
  return { win, respostas, winLis, nosDoBody, criadas, Original: FalsaPC, store, notificar }
}

let proximoId = 1
async function comando(amb, nome, payload) {
  const id = 'c' + (proximoId++)
  const ev = {
    origin: 'http://cliente', source: amb.win.parent,
    data: { protocol: 'bravophone/v1', type: 'command', id, command: nome, payload },
  }
  ;(amb.winLis.message || []).forEach((fn) => fn(ev))
  for (let i = 0; i < 40; i++) {
    const r = amb.respostas.find((m) => m.type === 'reply' && m.id === id)
    if (r) {
      if (r.error) throw new Error(r.error)
      return r.payload
    }
    await espera(10)
  }
  throw new Error('sem resposta para ' + nome)
}

const eventos = (amb, nome) =>
  amb.respostas.filter((m) => m.type === 'event' && m.name === nome)

console.log('\nICE — a ponte envolve o RTCPeerConnection sem quebrá-lo:')
{
  const amb = montarAmbiente()
  check('o construtor foi envolvido', amb.win.RTCPeerConnection !== amb.Original)
  check('uma segunda carga não envolve de novo',
    amb.win.RTCPeerConnection.__bpEnvolvido === true)

  const pc = new amb.win.RTCPeerConnection({})
  check('instanceof continua valendo', pc instanceof amb.Original)
  check('a conexão real é criada', amb.criadas.length === 1)
  check('os estáticos vão junto (generateCertificate)',
    typeof amb.win.RTCPeerConnection.generateCertificate === 'function')
  check('e os outros estáticos também',
    amb.win.RTCPeerConnection.marcaEstatica === 42)
}

console.log('\nICE — os servidores do integrador entram na conexão:')
{
  const amb = montarAmbiente({ iceServers: STUN })
  new amb.win.RTCPeerConnection({})
  check('vindos do srcdoc (window.__bpIceServers)',
    JSON.stringify(amb.criadas[0].cfg.iceServers) === JSON.stringify(STUN),
    JSON.stringify(amb.criadas[0].cfg))

  // Configuração explícita de quem cria a conexão continua mandando: só
  // completamos o que veio vazio.
  const proprios = [{ urls: 'turn:turn.outro.com:443?transport=tcp' }]
  new amb.win.RTCPeerConnection({ iceServers: proprios })
  check('mas não sobrescreve quem já trouxe os seus',
    JSON.stringify(amb.criadas[1].cfg.iceServers) === JSON.stringify(proprios))
}

console.log('\nICE — o comando da ponte cobre o modo hospedado:')
{
  const amb = montarAmbiente()
  new amb.win.RTCPeerConnection({})
  check('sem configuração, nada é injetado', amb.criadas[0].cfg.iceServers === undefined)

  const r = await comando(amb, 'ice', { iceServers: STUN })
  check('o comando responde quantos servidores aceitou', r && r.servers === 1,
    JSON.stringify(r))
  new amb.win.RTCPeerConnection({})
  check('e a próxima conexão já nasce com eles',
    JSON.stringify(amb.criadas[1].cfg.iceServers) === JSON.stringify(STUN))
}

console.log('\nICE — coleta vazia vira aviso, não silêncio:')
{
  const amb = montarAmbiente()
  const pc = new amb.win.RTCPeerConnection({})
  pc.coletar({ candidatos: [] })

  const avisos = eventos(amb, 'media:blocked')
  check('a ponte emite media:blocked', avisos.length === 1, avisos.length)
  check('com o motivo que o integrador pode tratar',
    avisos[0] && avisos[0].payload.reason === 'no_ice_candidates')
  check('e com um texto para mostrar a quem ligou',
    /VPN/.test((avisos[0] && avisos[0].payload.message) || ''))
  check('a faixa aparece na janela',
    amb.nosDoBody.some((n) => n.className === 'bp-aviso-midia'))
}

console.log('\nICE — com candidato, ninguém é avisado:')
{
  const amb = montarAmbiente()
  const pc = new amb.win.RTCPeerConnection({})
  pc.coletar({ candidatos: ['candidate:1 1 UDP 2130706431 192.168.0.10 50000 typ host'] })
  check('nenhum media:blocked', eventos(amb, 'media:blocked').length === 0)
  check('e nenhuma faixa', !amb.nosDoBody.some((n) => n.className === 'bp-aviso-midia'))
}

console.log('\nICE — a faixa some quando a chamada termina:')
{
  const amb = montarAmbiente()
  const pc = new amb.win.RTCPeerConnection({})
  pc.coletar({ candidatos: [] })
  const faixa = amb.nosDoBody.find((n) => n.className === 'bp-aviso-midia')
  let removida = false
  faixa.remove = () => { removida = true }

  // O vigia compara um retrato com o anterior: primeiro em chamada, depois
  // fora dela. Ele só começa quando acha o store, o que é assíncrono.
  await espera(30)
  amb.store.state.callActive = true
  amb.notificar()
  amb.store.state.callActive = false
  amb.notificar()
  check('o fim da chamada tira a faixa', removida,
    'a faixa ficaria para sempre na janela')
}

console.log('\nICE — o srcdoc entrega os servidores antes do bundle:')
{
  const rodar = (opts) => {
    const html = buildSrcdoc({ version: '0', parentOrigin: 'https://x.com', ...opts })
    const script = html.match(/<script>([\s\S]*?)<\\?\/script>/)[1]
    const window = { addEventListener() {} }
    vm.runInNewContext(script, {
      window,
      document: { querySelector: () => null, activeElement: null, hasFocus: () => false },
      localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
      setTimeout: () => 0, Date, Number, JSON,
    })
    return { window, html }
  }

  const com = rodar({ iceServers: STUN })
  check('publica window.__bpIceServers',
    JSON.stringify(com.window.__bpIceServers) === JSON.stringify(STUN),
    JSON.stringify(com.window.__bpIceServers))
  // Antes do bundle: o guest-bridge lê essa variável ao envolver o
  // construtor, e a conexão só nasce na primeira chamada.
  check('o script inline vem antes de popup.js',
    com.html.indexOf('__bpIceServers') < com.html.indexOf('popup.js'))

  const sem = rodar({})
  check('sem a opção, nada é publicado', sem.window.__bpIceServers === undefined)
  check('e o cfg leva iceServers null', /"iceServers":null/.test(sem.html))
}

console.log('\nICE — o SDK passa a opção adiante:')
{
  const widget = await readFile(join(ROOT, 'src/widget.js'), 'utf8')
  check('o srcdoc recebe iceServers', /email: emailDeLogin, iceServers,/.test(widget))
  check('e o hospedado recebe pela ponte',
    /if \(iceServers && !srcdoc\) \{[\s\S]*?bridge\.call\('ice'/.test(widget))

  const tipos = await readFile(join(ROOT, 'types/index.d.ts'), 'utf8')
  check('a opção está nos tipos', /iceServers\?: RTCIceServer\[\]/.test(tipos))
  check('e o evento também', /'media:blocked':/.test(tipos))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
