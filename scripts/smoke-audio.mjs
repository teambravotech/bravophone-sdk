// Exercita a troca de placa de som durante a chamada (js/bravophone-audio.js).
//
// POR QUE EXISTE: os seletores de dispositivo moram na aba Ajustes, e a tela de
// chamada cobre o conteúdo das abas — exatamente quando alguém descobre que
// está falando na placa errada, o controle some. Este arquivo traz o controle
// para dentro da chamada.
//
// O QUE ESTE TESTE SEGURA: que a troca vai pelo store (é o watcher do bundle
// que chama o changeDevice do libwebphone, e é ele que sabe trocar a track sem
// derrubar a sessão SIP), que nada é inserido na árvore do Vue, e que o
// controle só existe enquanto a chamada existe.
//
// O QUE ELE NÃO PODE SEGURAR: se o áudio de fato trocou. Isso é navegador.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FONTE = await readFile(join(ROOT, 'host/js/bravophone-audio.js'), 'utf8')

// O CSS é montado por concatenação de literais; juntamos os pedaços para
// poder consultar uma regra inteira em vez de um fragmento de linha.
const CSS = FONTE.replace(/',\s*\n\s*'/g, '')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const espera = (ms = 40) => new Promise((r) => setTimeout(r, ms))

const I18N = {
  settingsSectionAudio: 'Áudio',
  settingsAudioMic: 'Microfone',
  settingsAudioSpeaker: 'Alto-falantes',
  settingsAudioDeviceFallback: 'Padrão do sistema',
  globalClose: 'Fechar',
  transferEmpty: 'Nenhum ramal disponível',
}

/**
 * Cores literais fora dos fallbacks das variáveis.
 *
 * `var(--bp-panel,#171b28)` é legítimo: o hex ali é a rede de segurança para
 * quando a variável não existe. Um hex solto seria paleta paralela.
 */
function corAvulsa(fonte) {
  const semFallback = fonte.replace(/var\([^)]*\)/g, '')
  // rgba(0,0,0,...) em sombra é neutro, não é cor de marca.
  const semSombra = semFallback.replace(/rgba\(0,\s*0,\s*0[^)]*\)/g, '')
  return semSombra.match(/#[0-9a-fA-F]{3,8}\b/g) || []
}

function criarNo(tag, classe = '') {
  const no = {
    tagName: tag.toUpperCase(),
    className: classe,
    style: { setProperty() {}, removeProperty() {} },
    hidden: false, textContent: '', innerHTML: '', title: '', type: '',
    offsetWidth: 78, offsetHeight: 24, offsetParent: {},
    _lis: {}, _filhos: {},
    addEventListener(t, fn) { (this._lis[t] = this._lis[t] || []).push(fn) },
    removeEventListener() {},
    appendChild() {}, remove() { this.removido = true },
    contains() { return false },
    getBoundingClientRect: () => ({ left: 20, top: 100, right: 98, bottom: 124, width: 78, height: 24 }),
    getAttribute(k) { return this._attrs ? this._attrs[k] : null },
    setAttribute(k, v) { (this._attrs = this._attrs || {})[k] = v },
    // Cria o filho sob demanda: o arquivo consulta por seletor e escreve
    // nele, e guardar o nó deixa o markup gerado disponível para asserção.
    querySelector(sel) {
      if (!this._filhos[sel]) this._filhos[sel] = criarNo('div', sel.replace(/[.#]/g, ''))
      return this._filhos[sel]
    },
    classList: {
      _c: new Set(),
      toggle(c, on) { if (on) this._c.add(c); else this._c.delete(c) },
      add(c) { this._c.add(c) }, remove(c) { this._c.delete(c) },
      contains(c) { return this._c.has(c) },
    },
  }
  no.classList = { ...no.classList, _c: new Set() }
  return no
}

function montarAmbiente({ emChamada = true, telaVisivel = true, transferindo = false,
                          dispositivos = null, semStream = false } = {}) {
  const commits = []
  const estado = {
    callActive: emChamada, callPhase: 'connected',
    deviceAudioInputId: 'mic-a', deviceAudioOutputId: 'spk-a',
  }
  const chaves = {
    setDeviceAudioInputId: 'deviceAudioInputId',
    setDeviceAudioOutputId: 'deviceAudioOutputId',
  }
  const vuex = {
    state: estado,
    commit: (k, v) => { commits.push([k, v]); if (chaves[k]) estado[chaves[k]] = v },
  }
  const appEl = { __vue_app__: { config: { globalProperties: { $store: vuex } } } }

  const telaChamada = criarNo('div', 'call-screen')
  if (!telaVisivel) telaChamada.offsetParent = null
  const pilulaBundle = criarNo('button', 'commands-pill')
  const overlayTransfer = criarNo('div', 'commands-overlay')
  const faixaVolume = criarNo('input', 'volume')

  const criados = []
  const corpoCls = new Set()
  const varsCorpo = {}

  const doc = {
    readyState: 'complete',
    head: { appendChild() {} },
    body: {
      appendChild: (n) => { criados.push(n); return n },
      classList: {
        add: (c) => corpoCls.add(c), remove: (c) => corpoCls.delete(c),
        contains: (c) => corpoCls.has(c),
      },
      style: {
        setProperty: (k, v) => { varsCorpo[k] = v },
        removeProperty: (k) => { delete varsCorpo[k] },
      },
    },
    getElementById: (id) => (id === 'bp-audio-estilo' ? null : id === 'app' ? appEl : null),
    createElement: (t) => criarNo(t),
    querySelector: (sel) => {
      if (sel === '.call-screen') return emChamada ? telaChamada : null
      if (sel === '.call-screen .commands-pill') return emChamada ? pilulaBundle : null
      if (sel === '.call-screen .commands-overlay') return transferindo ? overlayTransfer : null
      if (sel === '.call-screen input[type="range"]') return faixaVolume
      return null
    },
    addEventListener() {}, removeEventListener() {},
  }

  const lista = dispositivos || [
    { kind: 'audioinput', deviceId: 'mic-a', label: 'Headset USB (Jabra)' },
    { kind: 'audioinput', deviceId: 'mic-b', label: 'Microfone interno' },
    { kind: 'audiooutput', deviceId: 'spk-a', label: 'Headset USB (Jabra)' },
    { kind: 'audiooutput', deviceId: 'spk-b', label: 'Alto-falantes (Realtek)' },
    { kind: 'videoinput', deviceId: 'cam', label: 'Webcam' },
  ]

  // O <audio> do stream remoto não está no DOM: quem o tem é o libwebphone.
  const trilhas = semStream ? [] : [{ kind: 'audio' }]
  const streamRemoto = { getAudioTracks: () => trilhas }
  const chamada = { getRemoteAudio: () => ({ srcObject: streamRemoto }) }
  const grafo = { conexoes: [], fechado: false }

  const mdLis = {}
  const win = {
    document: doc,
    innerHeight: 800,
    console: { log() {}, warn() {}, error() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class { constructor(fn) { win.__redesenhou = fn } observe() {} disconnect() {} },
    navigator: {
      mediaDevices: {
        enumerateDevices: () => Promise.resolve(lista),
        addEventListener: (t, fn) => { (mdLis[t] = mdLis[t] || []).push(fn) },
      },
    },
    chrome: { i18n: { getMessage: (k) => I18N[k] || '' } },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => {},
    AudioContext: class {
      constructor() { this.state = 'running'; this.destination = { nome: 'destination' } }
      createMediaStreamSource(s) {
        grafo.fonte = s
        return { connect: (n) => grafo.conexoes.push(['fonte', n.nome]) }
      }
      createAnalyser() {
        return {
          nome: 'analyser', fftSize: 0, smoothingTimeConstant: 0,
          connect: (n) => grafo.conexoes.push(['analyser', n.nome]),
          getByteTimeDomainData: (b) => { for (let i = 0; i < b.length; i++) b[i] = 128 },
        }
      }
      createGain() {
        return { nome: 'gain', gain: { value: 1 },
                 connect: (n) => grafo.conexoes.push(['gain', n.nome]) }
      }
      close() { grafo.fechado = true }
    },
    __bpWebphone: { getCallList: () => ({ getCall: () => chamada }) },
    addEventListener() {}, removeEventListener() {},
  }
  win.window = win

  vm.createContext(win)
  vm.runInContext(FONTE, win)

  return { win, commits, estado, criados, corpoCls, varsCorpo, telaChamada,
           pilulaBundle, mdLis, grafo, streamRemoto,
           medidor: () => criados.find((n) => String(n.className).includes('bp-audio-medidor')),
           pilulas: () => criados.filter((n) => String(n.className).includes('bp-audio-pilula')),
           pilula: (modo) => criados.find((n) =>
             String(n.className).includes('bp-audio-pilula') &&
             n.getAttribute('data-modo') === modo),
           painel: () => criados.find((n) => String(n.className).includes('bp-audio-painel')) }
}

/** Clica a pílula de um modo, como o operador faria. */
function clicarPilula(amb, modo) {
  const p = amb.pilula(modo)
  ;(p._lis.click || []).forEach((fn) => fn({
    preventDefault() {}, stopPropagation() {},
  }))
}

/** Clica um item da lista do painel aberto. */
function clicarItem(amb, modo, id) {
  const item = { getAttribute: (k) => ({ 'data-modo': modo, 'data-id': id }[k]) }
  ;(amb.painel()._lis.click || []).forEach((fn) => fn({
    target: { closest: (sel) => (sel === '.bp-audio-item' ? item : null) },
    preventDefault() {}, stopPropagation() {},
  }))
}

// --- os testes -------------------------------------------------------------

console.log('\náudio — o controle só existe durante a chamada:')
{
  const a = montarAmbiente({ emChamada: true })
  await espera()
  check('em chamada, monta', a.pilulas().length === 2 && !!a.painel())

  const b = montarAmbiente({ emChamada: false })
  await espera()
  check('fora de chamada, não monta', b.pilulas().length === 0, 'montou sem chamada')

  // A tela de chamada existe com v-show: sem offsetParent ela está escondida.
  const c = montarAmbiente({ emChamada: true, telaVisivel: false })
  await espera()
  check('tela escondida não conta como em chamada', c.pilulas().length === 0)

  // Ao desligar, some.
  const d = montarAmbiente({ emChamada: true })
  await espera()
  const pilula = d.pilula('entrada')
  d.estado.callActive = false
  d.win.__redesenhou()
  await espera()
  check('desligou, desmonta', pilula.removido === true)
  check('e devolve a margem da pílula do bundle',
    !d.corpoCls.has('bp-audio'), [...d.corpoCls].join(','))
}

console.log('\náudio — nada entra na árvore do Vue:')
{
  // Inserir entre irmãos que o Vue diffa fez a página recarregar em loop antes:
  // o componente do webphone tem unmounted(){ location.reload() }.
  const a = montarAmbiente()
  await espera()
  check('as pílulas e o painel vão para o body',
    a.criados.length >= 3 && a.pilulas().length === 2 && !!a.painel())
  check('a fonte não faz insertBefore em nada do app',
    !/insertBefore/.test(FONTE))
  // O ajuste na tela do app é sempre por CSS escopado no body — nunca por um
  // nó novo entre irmãos que o Vue diffa.
  check('o ajuste na tela do app é por CSS no body',
    /body\.bp-audio \.call-screen \.commands-pill\{/.test(FONTE))
}

console.log('\náudio — dois botões, dois painéis:')
{
  // "o que eu falo" e "o que eu ouço" são problemas diferentes, e quem está na
  // ligação já sabe qual dos dois está errado: a escolha começa no botão.
  const a = montarAmbiente()
  await espera()
  check('há uma pílula para cada modo',
    a.pilulas().length === 2 && !!a.pilula('entrada') && !!a.pilula('saida'),
    a.pilulas().length)
  check('o painel começa fechado', a.painel().hidden === true)

  clicarPilula(a, 'entrada')
  const modo = () => a.painel()._filhos['.bp-audio-modo'].textContent
  check('abre no microfone', a.painel().hidden === false && modo() === 'Microfone', modo())
  check('e a pílula do microfone fica marcada',
    a.pilula('entrada').classList.contains('aberta') &&
    !a.pilula('saida').classList.contains('aberta'))

  clicarPilula(a, 'saida')
  check('trocar de botão troca o painel', modo() === 'Alto-falantes', modo())
  check('e a marcação acompanha',
    a.pilula('saida').classList.contains('aberta') &&
    !a.pilula('entrada').classList.contains('aberta'))

  // O botão é o próprio interruptor.
  clicarPilula(a, 'saida')
  check('clicar na pílula aberta fecha', a.painel().hidden === true)
}

console.log('\náudio — cada painel mostra uma lista só:')
{
  const a = montarAmbiente()
  await espera()
  const lista = () => a.painel()._filhos['.bp-audio-lista'].innerHTML

  clicarPilula(a, 'entrada')
  check('no microfone, só entradas',
    /Headset USB/.test(lista()) && /Microfone interno/.test(lista()) &&
    !/Realtek/.test(lista()), lista().slice(0, 160))
  check('a câmera nunca aparece', !/Webcam/.test(lista()))
  check('marca o que está em uso',
    /data-id="mic-a"/.test(lista()) && lista().includes('aria-selected="true"'))

  clicarPilula(a, 'saida')
  check('nos alto-falantes, só saídas',
    /Realtek/.test(lista()) && !/Microfone interno/.test(lista()), lista().slice(0, 160))
}

console.log('\náudio — a troca vai pelo store:')
{
  const a = montarAmbiente()
  await espera()

  clicarPilula(a, 'entrada')
  clicarItem(a, 'entrada', 'mic-b')
  check('commitou a entrada',
    a.commits.some(([k, v]) => k === 'setDeviceAudioInputId' && v === 'mic-b'),
    JSON.stringify(a.commits))

  // É o watcher do bundle que chama getMediaDevices().changeDevice — quem sabe
  // trocar a track de uma chamada em curso é o libwebphone, não nós.
  // Procura a CHAMADA, não a menção: o cabeçalho do arquivo cita as duas para
  // explicar por que não são usadas.
  check('não chama setSinkId nem getUserMedia por conta própria',
    !/\.setSinkId\s*\(/.test(FONTE) && !/getUserMedia\s*\(/.test(FONTE))

  clicarPilula(a, 'saida')
  clicarItem(a, 'saida', 'spk-b')
  check('e commitou a saída',
    a.commits.some(([k, v]) => k === 'setDeviceAudioOutputId' && v === 'spk-b'))

  // Um modo desconhecido não pode escrever em nada.
  const antes = a.commits.length
  clicarItem(a, 'inexistente', 'x')
  check('modo desconhecido não commita', a.commits.length === antes)
}

console.log('\náudio — a paleta é a do app:')
{
  // Uma versão anterior usava as classes do bundle (bg-gray-50 e companhia).
  // Elas chegavam, mas o tema não: as regras do dark-theme são escopadas em
  // `#app .bg-gray-50`, e o painel vive no body. O painel saía branco.
  check('lê as variáveis do tema',
    /var\(--bp-panel/.test(FONTE) && /var\(--bp-border/.test(FONTE) &&
    /var\(--bp-text/.test(FONTE))
  check('e não há cor solta fora dos fallbacks das variáveis',
    corAvulsa(FONTE).length === 0, corAvulsa(FONTE).join(', '))
}

console.log('\náudio — sem permissão de microfone, o nome vem do app:')
{
  const a = montarAmbiente({
    dispositivos: [
      { kind: 'audioinput', deviceId: 'mic-a', label: '' },
      { kind: 'audiooutput', deviceId: 'spk-a', label: '' },
    ],
  })
  await espera()
  clicarPilula(a, 'entrada')
  const lista = a.painel()._filhos['.bp-audio-lista']
  // O label vem vazio até a permissão ser concedida; o app já tem um nome para
  // esse caso, e é o mesmo que a aba Ajustes mostra.
  check('cai no rótulo do locale', /Padrão do sistema/.test(lista.innerHTML),
    lista.innerHTML.slice(0, 140))
}

console.log('\náudio — não compete com o painel de transferência:')
{
  const a = montarAmbiente({ transferindo: true })
  await espera()
  // O painel de transferência sobe por cima de tudo dentro da tela de chamada.
  check('as duas pílulas se escondem',
    a.pilula('entrada').hidden === true && a.pilula('saida').hidden === true)
}

console.log('\náudio — headset plugado atualiza a lista:')
{
  const a = montarAmbiente()
  await espera()
  check('registrou o devicechange', (a.mdLis.devicechange || []).length === 1)
}

console.log('\náudio — a pílula de transferência do bundle sai de cena:')
{
  // A mesma ação já está na grade logo acima, então a pílula era redundante.
  // Escondemos por VISIBILIDADE, e não com display: ela continua ocupando a
  // linha e é nela que a nossa pílula se ancora para ficar centrada.
  const a = montarAmbiente()
  await espera()
  check('marca o body para a regra pegar', a.corpoCls.has('bp-audio'))
  check('esconde por visibility, não por display',
    /commands-pill\{visibility:hidden/.test(FONTE) &&
    !/commands-pill\{display:none/.test(FONTE))
  check('e não empurra mais nada com margem',
    !/--bp-audio-vao/.test(FONTE))
}

console.log('\náudio — o medidor de nível sobre o controle de volume:')
{
  const a = montarAmbiente()
  await espera()
  check('a barra foi criada', !!a.medidor())
  check('e fica sobre o trilho do volume',
    a.medidor().style.left !== undefined)

  // createMediaElementSource REDIRECIONA a saída do elemento: sem reconectar
  // no destination, o áudio da chamada para. Só createMediaStreamSource deriva
  // sem tocar em quem está tocando — a diferença entre medir e mudar.
  // Procura a CHAMADA, não a menção: o comentário do arquivo cita o método
  // proibido justamente para explicar por que não é usado.
  check('deriva o stream, não o elemento',
    !/createMediaElementSource\s*\(/.test(FONTE) &&
    /createMediaStreamSource\s*\(/.test(FONTE))
  check('e é o stream remoto que entra no grafo',
    a.grafo.fonte === a.streamRemoto)

  // O analyser sozinho nem sempre é puxado pelo navegador; um ganho ZERO
  // garante o processamento sem somar um decibel ao que se ouve.
  const rota = a.grafo.conexoes.map(([de, para]) => de + '>' + para).join(' ')
  check('fonte → analyser → ganho → destination',
    rota === 'fonte>analyser analyser>gain gain>destination', rota)

  // Um ganho diferente de zero seria eco da própria chamada.
  check('o ganho é zero', /gain\.value = 0/.test(FONTE) ||
    /mudo\.gain\.value = 0/.test(FONTE))

  // Sem pointer-events:none a barra engoliria o arrasto do volume.
  check('não rouba o clique do controle',
    /\.bp-audio-medidor\{[^}]*pointer-events:none/.test(CSS))
}

console.log('\náudio — o medidor vai embora com a chamada:')
{
  const a = montarAmbiente()
  await espera()
  const barra = a.medidor()
  a.estado.callActive = false
  a.win.__redesenhou()
  await espera()
  check('a barra some', barra.removido === true)
  // Um AudioContext por chamada que nunca fecha é vazamento: o navegador
  // limita quantos existem ao mesmo tempo.
  check('e o AudioContext é fechado', a.grafo.fechado === true)
}

console.log('\náudio — sem stream remoto, não mede:')
{
  const a = montarAmbiente({ semStream: true })
  await espera()
  check('não cria a barra', !a.medidor())
  check('e não abre AudioContext', a.grafo.conexoes.length === 0)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
