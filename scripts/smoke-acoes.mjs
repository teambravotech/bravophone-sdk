// Exercita as ações em chamada da API pública do SDK.
//
// POR QUE EXISTE: hangup, answer, mute, hold, dtmf e transfer emitiam no
// emitter do app. Nesta build de PRODUÇÃO do Vue o emitter não é alcançável —
// medido no navegador: `app._instance` é false e nenhum elemento tem
// `__vueParentComponent`. Os seis esperavam 20s e rejeitavam. Nunca
// funcionaram, e não havia teste nenhum sobre eles: foi assim que passaram
// despercebidos.
//
// Agora clicam os botões da tela, que é o caminho do usuário. O preço é
// depender do DOM da tela de chamada, e é justamente isso que este arquivo
// vigia — os seletores estão presos aqui, então uma mudança na tela quebra o
// teste antes de quebrar o integrador.

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

const I18N = {
  webphoneCallHangup: 'Desligar',
  webphoneCallAnswer: 'Atender',
  webphoneCallMake: 'Ligar',
  callActionMute: 'Silenciar',
  callActionMuted: 'Ativar som',
  callActionHold: 'Em espera',
  callActionResume: 'Retomar',
  callActionTransfer: 'Transferir',
  globalClear: 'Limpar',
  dialerBackspace: 'Apagar último',
}

function botao({ titulo = null, texto = '', classe = '', disabled = false }) {
  const b = {
    tagName: 'BUTTON', textContent: texto, className: classe, disabled,
    cliques: 0,
    getAttribute: (k) => (k === 'title' ? titulo : null),
    setAttribute() {},
    click() { this.cliques++ },
  }
  b.closest = (sel) => (b.className.split(' ').includes(sel.replace('.', '')) ? b : null)
  return b
}

function montarAmbiente({ comLista = true, ramalAtivo = true,
                          campoMontado = true, semRotas = false } = {}) {
  const respostas = []   // o que a ponte devolveu ao pai
  const winLis = {}
  const preenchidos = []
  let selecionada = { id: 'r1', name: 'Tronco A', prefix: '0' }
  const tela = {
    desligar: botao({ titulo: 'Desligar' }),
    atender: botao({ titulo: 'Atender' }),
    mudo: botao({ texto: 'Silenciar', classe: 'call-action' }),
    espera: botao({ texto: 'Em espera', classe: 'call-action' }),
    transferir: botao({ texto: 'Transferir', classe: 'call-action' }),
    limpar: botao({ texto: 'Limpar' }),
  }
  const teclas = ['1', '2ABC', '3DEF', '4GHI', '5JKL', '6MNO',
                  '7PQRS', '8TUV', '9WXYZ', '*', '0+', '#'].map((t) => botao({ texto: t }))
  const ramais = comLista
    ? [botao({ texto: 'Maria Silva · 2011', disabled: !ramalAtivo }),
       botao({ texto: 'Joao Souza · 2012', disabled: false })]
    : []

  const store = {
    state: { callActive: true, callPhase: 'connected', isLogged: true, extension: { username: '1001' } },
    commit() {}, subscribe() {},
  }
  const appEl = {
    __vue_app__: { config: { globalProperties: { $store: store } } },
    style: {},
  }

  const doc = {
    readyState: 'complete',
    visibilityState: 'visible',
    baseURI: 'http://host/',
    head: { appendChild() {} },
    body: { appendChild() {}, style: { setProperty() {}, removeProperty() {} }, classList: { add() {}, remove() {} } },
    getElementById: (id) => (id === 'app' ? appEl : null),
    createElement: () => ({
      style: { setProperty() {}, removeProperty() {} }, setAttribute() {}, appendChild() {},
      remove() {}, classList: { add() {}, remove() {}, toggle() {} },
      querySelector: () => ({ textContent: '', onclick: null }),
      animate() {},
    }),
    querySelector: (sel) => (sel === '.keypad' ? { querySelectorAll: () => teclas } : null),
    querySelectorAll: (sel) => {
      if (sel === '.call-screen button[title]') return [tela.desligar, tela.atender]
      if (sel === '.call-screen button.call-action') return [tela.mudo, tela.espera, tela.transferir]
      if (sel === '.call-screen .space-y-2 button') return ramais
      if (sel === 'button') return [...Object.values(tela), ...teclas, ...ramais]
      if (sel === 'button[title]') return [tela.desligar, tela.atender]
      return []
    },
    addEventListener() {}, removeEventListener() {},
  }

  const win = {
    document: doc,
    location: { href: 'http://host/', search: '', origin: 'http://host' },
    navigator: { language: 'pt-BR', mediaDevices: { addEventListener() {} } },
    parent: { postMessage: (m) => respostas.push(m) },
    __bpParentOrigin: 'http://cliente',
    // O campo de discagem publica este gancho quando esta montado.
    __bpInputPreencher: (t) => { preenchidos.push(String(t)); return campoMontado },
    BravoPhoneRoutes: semRotas ? undefined : {
      whenReady: () => Promise.resolve(),
      getRoutes: () => [
        { id: 'r1', name: 'Tronco A', prefix: '0' },
        { id: 'r2', name: 'Tronco B', prefix: null },
      ],
      getSelected: () => selecionada,
      getPrefix: () => (selecionada && selecionada.prefix) || '',
      select: (id) => { selecionada = { id: String(id), name: 'Tronco', prefix: '9' } },
    },
    console: { log() {}, warn() {}, error() {}, info() {} },
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
  return { win, tela, teclas, ramais, respostas, winLis, preenchidos,
           rotaAtual: () => selecionada }
}

/**
 * Chama um comando pelo MESMO caminho do integrador: um postMessage com o
 * protocolo, e a resposta lida de volta no postMessage para o pai.
 *
 * Testar a tabela interna direto seria mais fácil e testaria menos — o
 * despacho e a serialização do erro fazem parte do contrato público.
 */
let proximoId = 1
async function comando(amb, nome, payload) {
  const id = 'c' + (proximoId++)
  const ev = {
    origin: 'http://cliente',
    source: amb.win.parent,
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

// --- os testes -------------------------------------------------------------

console.log('\nações — a ponte responde pelo protocolo:')
{
  const a = montarAmbiente()
  await espera()
  await comando(a, 'hangup')
  check('um comando conhecido responde', a.respostas.some((m) => m.type === 'reply'))

  let erro = null
  await comando(a, 'naoExiste').catch((e) => { erro = e.message })
  check('um desconhecido volta com erro nomeado',
    /comando desconhecido/.test(erro || ''), erro)
}

console.log('\nações — cada uma clica o botão certo:')
{
  const a = montarAmbiente()
  await espera()

  await comando(a, 'hangup')
  check('hangup clica Desligar', a.tela.desligar.cliques === 1, a.tela.desligar.cliques)

  await comando(a, 'answer')
  check('answer clica Atender', a.tela.atender.cliques === 1)

  await comando(a, 'mute')
  check('mute clica a ação de silenciar', a.tela.mudo.cliques === 1)

  await comando(a, 'hold')
  check('hold clica a ação de espera', a.tela.espera.cliques === 1)

  check('e nenhuma clicou a errada',
    a.tela.desligar.cliques === 1 && a.tela.atender.cliques === 1 &&
    a.tela.mudo.cliques === 1 && a.tela.espera.cliques === 1)
}

console.log('\nações — o rótulo do mudo alterna, e a busca acompanha:')
{
  const a = montarAmbiente()
  await espera()
  // Com o som já cortado o botão passa a dizer "Ativar som"; procurar só por
  // "Silenciar" perderia o botão justamente depois do primeiro uso.
  a.tela.mudo.textContent = 'Ativar som'
  await comando(a, 'mute')
  check('acha pelo rótulo invertido', a.tela.mudo.cliques === 1)

  a.tela.espera.textContent = 'Retomar'
  await comando(a, 'hold')
  check('idem para retomar da espera', a.tela.espera.cliques === 1)
}

console.log('\nações — botão desabilitado devolve erro, não silêncio:')
{
  const a = montarAmbiente()
  await espera()
  // mute e hold ficam desabilitados fora de "connected".
  a.tela.mudo.disabled = true
  let erro = null
  await comando(a, 'mute').catch((e) => { erro = e.message })
  check('recusou', erro !== null, erro)
  check('e diz o porquê', /indisponivel/.test(erro || ''), erro)
  check('sem clicar', a.tela.mudo.cliques === 0)
}

console.log('\nações — DTMF vai tecla por tecla:')
{
  const a = montarAmbiente()
  await espera()
  await comando(a, 'dtmf', { tone: '4' })
  const t4 = a.teclas.find((t) => t.textContent === '4GHI')
  check('um tom clica a tecla', t4.cliques === 1, t4.cliques)

  const b = montarAmbiente()
  await espera()
  await comando(b, 'dtmf', { tone: '1*2' })
  check('uma sequência clica todas na ordem',
    b.teclas.find((t) => t.textContent === '1').cliques === 1 &&
    b.teclas.find((t) => t.textContent === '*').cliques === 1 &&
    b.teclas.find((t) => t.textContent === '2ABC').cliques === 1)

  const c = montarAmbiente()
  await espera()
  let erro = null
  await comando(c, 'dtmf', { tone: 'abc' }).catch((e) => { erro = e.message })
  check('tom sem dígito é recusado', /invalido/.test(erro || ''), erro)
}

console.log('\nações — transferir é dois passos na tela:')
{
  const a = montarAmbiente()
  await espera()
  await comando(a, 'transfer', { to: '2011' })
  check('abriu a lista', a.tela.transferir.cliques === 1)
  check('e escolheu o ramal pedido', a.ramais[0].cliques === 1, a.ramais[0].cliques)
  check('sem tocar no outro', a.ramais[1].cliques === 0)

  const b = montarAmbiente()
  await espera()
  let erro = null
  await comando(b, 'transfer', {}).catch((e) => { erro = e.message })
  check('sem destino, recusa antes de abrir nada',
    /destino ausente/.test(erro || '') && b.tela.transferir.cliques === 0, erro)

  // Ramal offline ou em ligação vem desabilitado: fingir que transferiu seria
  // pior que dizer que não deu.
  const c = montarAmbiente({ ramalAtivo: false })
  await espera()
  erro = null
  await comando(c, 'transfer', { to: '2011' }).catch((e) => { erro = e.message })
  check('ramal indisponível vira erro', /indisponivel/.test(erro || ''), erro)
}

console.log('\nações — o emitter não voltou pela porta dos fundos:')
{
  // Ele não existe nesta build; qualquer caminho novo até ele seria 20s de
  // espera e uma rejeição, que foi como os seis comandos viveram até aqui.
  check('nenhum findEmitter', !/function findEmitter/.test(FONTE))
  check('nenhum emitApp', !/function emitApp/.test(FONTE))
  check('e nenhum .emit( para o app',
    !/\bem\.emit\(/.test(FONTE) && !/emitter\.emit\(/.test(FONTE))
  // status.ready media prontidão pelo emitter, então vinha sempre false.
  check('status.ready mede pelo store', /ready: !!findStore\(\)/.test(FONTE))
}

console.log('\nações — setDial escreve sem discar:')
{
  // `call` disca na hora; nem todo fluxo quer isso. Vindo de um CRM, muitas
  // vezes o certo é deixar o número na tela para a pessoa conferir.
  const a = montarAmbiente()
  await espera()
  const r = await comando(a, 'setDial', { number: '11988887777' })
  check('escreveu no campo', a.preenchidos[0] === '11988887777', a.preenchidos[0])
  check('e devolve o que escreveu', r && r.number === '11988887777', JSON.stringify(r))
  check('sem discar', a.respostas.every((m) => !m.payload || !m.payload.phone))

  let erro = null
  await comando(a, 'setDial', {}).catch((e) => { erro = e.message })
  check('sem número, recusa', /numero ausente/.test(erro || ''), erro)

  // Fora da aba do teclado o campo não existe; dizer isso é melhor que
  // fingir que escreveu.
  const b = montarAmbiente({ campoMontado: false })
  await espera()
  erro = null
  await comando(b, 'setDial', { number: '123' }).catch((e) => { erro = e.message })
  check('campo desmontado vira erro', /nao esta montado/.test(erro || ''), erro)
}

console.log('\nações — a rota decide por onde a ligação sai:')
{
  const a = montarAmbiente()
  await espera()
  const r = await comando(a, 'routes')
  check('lista os troncos', r.routes.length === 2, JSON.stringify(r.routes))
  check('e diz qual está em uso', r.selected.id === 'r1', JSON.stringify(r.selected))
  // O prefixo do tronco entra no destino do INVITE.
  check('com o prefixo', r.prefix === '0', r.prefix)

  const t = await comando(a, 'setRoute', { id: 'r2' })
  check('trocou', a.rotaAtual().id === 'r2', a.rotaAtual().id)
  check('e devolve a nova seleção', t.selected.id === 'r2', JSON.stringify(t))

  // Selecionar um id inexistente deixaria o webphone sem rota, e a próxima
  // ligação sairia sem prefixo — falha silenciosa e cara.
  let erro = null
  await comando(a, 'setRoute', { id: 'nao-existe' }).catch((e) => { erro = e.message })
  check('id desconhecido é recusado', /rota desconhecida/.test(erro || ''), erro)
  check('e a rota anterior fica', a.rotaAtual().id === 'r2', a.rotaAtual().id)

  erro = null
  await comando(a, 'setRoute', {}).catch((e) => { erro = e.message })
  check('sem id, recusa', /id da rota ausente/.test(erro || ''), erro)

  const b = montarAmbiente({ semRotas: true })
  await espera()
  erro = null
  await comando(b, 'routes').catch((e) => { erro = e.message })
  check('sem seletor de rotas, erro claro',
    /indisponivel/.test(erro || ''), erro)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
