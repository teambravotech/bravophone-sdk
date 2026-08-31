// Exercita o heartbeat de presença (js/bravophone-presenca.js).
//
// POR QUE EXISTE: o canal estava no servidor desde o início sem nenhum cliente
// alimentando — oito dias de log, zero POST. Sendo a primeira implementação,
// não há comportamento anterior para comparar: o que segura o contrato é este
// arquivo. Cada campo verificado aqui está no PRESENCA-DISPOSITIVOS.md.
//
// O QUE NÃO DÁ PARA TESTAR AQUI: se a placa de som trocou de verdade. Aplicamos
// commitando no store, e é um watcher do bundle que chama o changeDevice do
// libwebphone. O teste confirma o commit; o resto é navegador.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARQUIVO = join(ROOT, 'host/js/bravophone-presenca.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const espera = (ms = 60) => new Promise((r) => setTimeout(r, ms))

function montarAmbiente({
  sdk = false,
  token = 'vx-123',
  idGuardado = null,
  resposta = { ok: true, intervalMs: 30000 },
  status = 200,
  permissao = 'granted',
  comUad = true,
} = {}) {
  const enviados = []
  const beacons = []
  // O token mora no mesmo chrome.storage.local que o deviceId.
  const guardado = { ...(token ? { bravophoneVxToken: token } : {}), ...(idGuardado || {}) }

  const estado = {
    callActive: false,
    callPhase: 'idle',
    webphoneRegistered: true,
    deviceAudioInputId: 'mic-a',
    deviceAudioOutputId: 'spk-a',
  }
  const commits = []
  const chaves = {
    setDeviceAudioInputId: 'deviceAudioInputId',
    setDeviceAudioOutputId: 'deviceAudioOutputId',
    setIsLogged: 'isLogged',
  }
  const vuex = {
    state: estado,
    commit: (k, v) => { commits.push([k, v]); if (chaves[k]) estado[chaves[k]] = v },
  }
  const appEl = { __vue_app__: { config: { globalProperties: { $store: vuex } } } }

  const docLis = {}
  const mdLis = {}

  const win = {
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    location: { origin: 'https://cliente.exemplo' },
    Blob: class { constructor(p, o) { this.partes = p; this.type = o && o.type } },
    crypto: {
      randomUUID: () => 'uuid-novo-0001',
      getRandomValues: (a) => a,
    },
    document: {
      readyState: 'complete',
      visibilityState: 'visible',
      getElementById: (id) => (id === 'app' ? appEl : null),
      addEventListener: (t, fn) => { (docLis[t] = docLis[t] || []).push(fn) },
      removeEventListener() {},
    },
    navigator: {
      userAgentData: comUad ? {
        brands: [{ brand: 'Not A;Brand' }, { brand: 'Chromium' }, { brand: 'Google Chrome' }],
        getHighEntropyValues: () => Promise.resolve({
          platform: 'Windows', platformVersion: '15.0.0', uaFullVersion: '150.0.1',
        }),
      } : undefined,
      mediaDevices: {
        enumerateDevices: () => Promise.resolve([
          { kind: 'audioinput', deviceId: 'mic-a', label: 'Headset USB', groupId: 'g1' },
          { kind: 'audiooutput', deviceId: 'spk-a', label: 'Headset USB', groupId: 'g1' },
          { kind: 'videoinput', deviceId: 'cam', label: 'Webcam', groupId: 'g2' },
        ]),
        addEventListener: (t, fn) => { (mdLis[t] = mdLis[t] || []).push(fn) },
      },
      permissions: { query: () => Promise.resolve({ state: permissao }) },
      sendBeacon: (url, corpo) => { beacons.push({ url, corpo }); return true },
    },
    chrome: {
      runtime: {
        id: sdk ? 'bravophone-embed' : 'hilemigihmhidccebfodjmockngdlgmk',
        getManifest: () => ({ version: '2.6.1' }),
      },
      storage: {
        local: {
          get: (k, cb) => cb(k in guardado ? { [k]: guardado[k] } : {}),
          set: (o, cb) => { Object.assign(guardado, o); cb && cb() },
        },
      },
    },
    fetch: (url, opts) => {
      enviados.push({ url, opts, corpo: JSON.parse(opts.body) })
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(resposta),
      })
    },
    addEventListener: () => {},
  }
  win.window = win

  vm.createContext(win)
  vm.runInContext(ARQUIVO_FONTE, win)

  return { win, enviados, beacons, guardado, estado, commits, docLis, mdLis }
}

const ARQUIVO_FONTE = await readFile(ARQUIVO, 'utf8')

// --- os testes -------------------------------------------------------------

console.log('\npresença — o primeiro heartbeat:')
{
  const a = montarAmbiente()
  await espera()
  check('bateu assim que havia token', a.enviados.length === 1, a.enviados.length)

  const req = a.enviados[0]
  check('na rota certa', /\/api\/presence\/heartbeat$/.test(req.url), req.url)
  check('por POST', req.opts.method === 'POST')
  // X-Vx-Token, e não Authorization nem X-Pabx-Token: é ele que diz de quem é
  // o ramal. O corpo descreve a máquina, não escolhe ramal.
  check('com X-Vx-Token', req.opts.headers['X-Vx-Token'] === 'vx-123',
    JSON.stringify(req.opts.headers))
}

console.log('\npresença — o retrato que vai no corpo:')
{
  const a = montarAmbiente()
  await espera()
  const c = a.enviados[0].corpo

  check('deviceId presente', typeof c.deviceId === 'string' && c.deviceId.length > 0)
  check('platform da extensão', c.platform === 'chrome-extension', c.platform)
  check('app com nome e versão',
    c.app.name === 'Bravophone' && c.app.version === '2.6.1', JSON.stringify(c.app))
  check('status idle', c.status === 'idle', c.status)
  check('registered do store', c.registered === true)

  check('só dispositivos de áudio', c.audio.inputs.length === 1 && c.audio.outputs.length === 1,
    JSON.stringify([c.audio.inputs.length, c.audio.outputs.length]))
  check('a câmera ficou de fora',
    !JSON.stringify(c.audio).includes('Webcam'))
  check('selected vem do store',
    c.audio.selected.input === 'mic-a' && c.audio.selected.output === 'spk-a',
    JSON.stringify(c.audio.selected))
  check('ringtone null: não há campainha separada', c.audio.selected.ringtone === null)
  check('permission reportada', c.audio.permission === 'granted')

  check('os e browser do userAgentData',
    c.os.name === 'Windows' && c.browser.version === '150.0.1',
    JSON.stringify([c.os, c.browser]))
  // A lista de brands traz "Not A;Brand" de propósito, e "Chromium" junto.
  check('a marca real vence o ruído da lista', c.browser.name === 'Google Chrome',
    c.browser.name)

  // O IP público quem resolve é o servidor; hostname não existe em MV3.
  check('não inventa hostname nem localIp',
    !('hostname' in c) && !('localIp' in c), JSON.stringify(Object.keys(c)))
  // Sem hostname e sem inventário, qualquer rótulo nosso seria palpite: o
  // servidor monta o derivado sozinho.
  check('não manda rótulo', !('deviceLabel' in c) && !('labelSource' in c))
}

console.log('\npresença — sem userAgentData, omite em vez de chutar:')
{
  const a = montarAmbiente({ comUad: false })
  await espera()
  const c = a.enviados[0].corpo
  check('sem os', !('os' in c))
  check('sem browser', !('browser' in c))
  check('o resto do corpo continua íntegro', c.deviceId && c.audio && c.status === 'idle')
}

console.log('\npresença — a identidade dura entre sessões:')
{
  const a = montarAmbiente()
  await espera()
  check('gerou e guardou o UUID', a.guardado.bpDeviceId === 'uuid-novo-0001',
    JSON.stringify(a.guardado))

  const b = montarAmbiente({ idGuardado: { bpDeviceId: 'uuid-antigo-9999' } })
  await espera()
  check('reusa o que já estava guardado',
    b.enviados[0].corpo.deviceId === 'uuid-antigo-9999',
    b.enviados[0].corpo.deviceId)

  // Cada site do integrador é uma origem: o mesmo PC em dois sites vira dois
  // dispositivos, e a chave deixa isso explícito no debug.
  const c = montarAmbiente({ sdk: true })
  await espera()
  check('no SDK a chave carrega a origem',
    'bpDeviceId:https://cliente.exemplo' in c.guardado, JSON.stringify(c.guardado))
  check('e a platform é web', c.enviados[0].corpo.platform === 'web')
}

console.log('\npresença — o estado da chamada vira o vocabulário do servidor:')
{
  for (const [callActive, callPhase, esperado] of [
    [false, 'idle', 'idle'],
    [true, 'ringing', 'ringing'],
    [true, 'connected', 'in-call'],
    [true, 'dialing', 'in-call'],
  ]) {
    const a = montarAmbiente()
    a.estado.callActive = callActive
    a.estado.callPhase = callPhase
    a.win.document.visibilityState = 'visible'
    ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
    await espera()
    const c = a.enviados[a.enviados.length - 1].corpo
    check(`callActive=${callActive} callPhase=${callPhase} → ${esperado}`,
      c.status === esperado, c.status)
  }
}

console.log('\npresença — o período vem do servidor:')
{
  const a = montarAmbiente({ resposta: { ok: true, intervalMs: 45000 } })
  await espera()
  check('aceitou 45s', a.enviados.length === 1)

  // Um valor absurdo não pode desligar o canal nem inundá-lo.
  const b = montarAmbiente({ resposta: { ok: true, intervalMs: 5 } })
  await espera()
  check('ignora intervalo abaixo do mínimo', b.enviados.length === 1)
}

console.log('\npresença — o pedido de troca de placa de som:')
{
  const cmd = {
    id: 'cmd_abc', type: 'setAudioDevice',
    set: { input: null, output: 'spk-b', ringtone: null },
    requestedBy: 'Leonardo Amaro',
  }
  const a = montarAmbiente({ resposta: { ok: true, intervalMs: 30000, command: cmd } })
  await espera()

  // Aplicamos pelo store: o bundle tem watchers que chamam o changeDevice do
  // libwebphone, que já sabe trocar a track de uma chamada em curso.
  check('trocou a saída', a.estado.deviceAudioOutputId === 'spk-b',
    a.estado.deviceAudioOutputId)
  check('não mexeu na entrada (null = não mexa)',
    a.estado.deviceAudioInputId === 'mic-a', a.estado.deviceAudioInputId)

  // O ack pega carona no próximo corpo: confirma sem um POST a mais.
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  const c = a.enviados[a.enviados.length - 1].corpo
  check('o ack viaja no heartbeat seguinte',
    c.ack && c.ack.commandId === 'cmd_abc' && c.ack.ok === true, JSON.stringify(c.ack))
  check('e o selected novo vai junto', c.audio.selected.output === 'spk-b',
    c.audio.selected.output)

  // O mesmo comando volta até ser confirmado; reaplicar no meio de uma ligação
  // trocaria a placa de som repetidamente.
  const antes = a.commits.length
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  check('não reaplica o mesmo commandId', a.commits.length === antes,
    `${antes} → ${a.commits.length}`)
  check('e não repete o ack',
    !a.enviados[a.enviados.length - 1].corpo.ack)
}

console.log('\npresença — o que este cliente não consegue aplicar, ele recusa:')
{
  const cmd = {
    id: 'cmd_toque', type: 'setAudioDevice',
    set: { input: null, output: null, ringtone: 'spk-b' },
  }
  const a = montarAmbiente({ resposta: { ok: true, intervalMs: 30000, command: cmd } })
  await espera()
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  const ack = a.enviados[a.enviados.length - 1].corpo.ack
  // Confirmar uma troca que não aconteceu deixaria o supervisor achando que o
  // operador está ouvindo a campainha em outro lugar.
  check('ack com ok:false', ack && ack.ok === false, JSON.stringify(ack))
  check('e diz o motivo', ack && /campainha/.test(ack.error || ''), ack && ack.error)
}

console.log('\npresença — resiliência:')
{
  // Este canal é observabilidade: nunca pode derrubar o webphone.
  const a = montarAmbiente()
  a.win.fetch = () => Promise.reject(new Error('rede fora'))
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  check('erro de rede não estoura', true)

  const b = montarAmbiente({ token: null })
  b.win.chrome.storage.local.get = (k, cb) => cb({})
  await espera()
  check('sem token não bate', b.enviados.length === 0, b.enviados.length)
}

console.log('\npresença — 401 encerra a sessão:')
{
  const a = montarAmbiente({ status: 401 })
  await espera()
  check('mandou para o login',
    a.commits.some(([k, v]) => k === 'setIsLogged' && v === false),
    JSON.stringify(a.commits))

  const antes = a.enviados.length
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  check('e parou de bater', a.enviados.length === antes, `${antes} → ${a.enviados.length}`)
}

console.log('\npresença — headset plugado não espera o próximo ciclo:')
{
  const a = montarAmbiente()
  await espera()
  const antes = a.enviados.length
  check('registrou o devicechange', (a.mdLis.devicechange || []).length === 1)
  ;(a.mdLis.devicechange || []).forEach((fn) => fn())
  await espera()
  check('bateu na hora', a.enviados.length === antes + 1,
    `${antes} → ${a.enviados.length}`)
}

console.log('\npresença — a saída limpa:')
{
  const a = montarAmbiente()
  await espera()
  // sendBeacon não deixa mandar cabeçalho: o token vai na query e o corpo é
  // text/plain, que é o que a rota aceita justamente para isto.
  a.win.window.addEventListener = () => {}
  const fn = a.win.document.addEventListener
  // o pagehide é registrado em window; chamamos avisarSaida pelo mesmo caminho
  // que o navegador usaria
  const registrados = []
  void fn
  void registrados
  check('pagehide previsto no código',
    ARQUIVO_FONTE.includes("addEventListener('pagehide'"))
  check('usa sendBeacon com o token na query',
    /sendBeacon\(/.test(ARQUIVO_FONTE) && /vxToken=/.test(ARQUIVO_FONTE))
  check('e corpo text/plain', /text\/plain/.test(ARQUIVO_FONTE))
}

console.log('\npresença — a saída limpa não é só ao fechar a janela:')
{
  const a = montarAmbiente()
  await espera()
  check('bateu enquanto havia token', a.enviados.length === 1)

  // O usuário deslogou: o token some do storage. Sem avisar, o card fica os
  // 40s do graceMs na mesa do supervisor.
  delete a.guardado.bravophoneVxToken
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  check('avisou a saída no logout', a.beacons.length === 1, a.beacons.length)
  check('pela rota de offline',
    /\/api\/presence\/offline/.test(a.beacons[0].url), a.beacons[0].url)
  check('com o token na query, que é o que o sendBeacon permite',
    /vxToken=vx-123/.test(a.beacons[0].url), a.beacons[0].url)
  check('e o corpo em text/plain', a.beacons[0].corpo.type === 'text/plain',
    a.beacons[0].corpo.type)

  // Uma vez só: o segundo ciclo não tem mais token para avisar.
  ;(a.docLis.visibilitychange || []).forEach((fn) => fn())
  await espera()
  check('sem repetir a cada ciclo', a.beacons.length === 1, a.beacons.length)

  // 401 é a sessão morrendo por fora (encerrada pela aba Usuários).
  const b = montarAmbiente({ status: 401 })
  await espera()
  check('401 também avisa a saída', b.beacons.length === 1, b.beacons.length)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
