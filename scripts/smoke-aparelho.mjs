// Exercita a identificação do aparelho no REGISTER (js/bravophone-aparelho.js).
//
// POR QUE EXISTE: os três cabeçalhos são opcionais e a borda tolera a falta de
// qualquer um — então nada dá erro quando o módulo quebra. A tela "Aparelhos"
// simplesmente volta a mostrar IP + nome do software, e ninguém liga isso a
// uma regressão aqui. O contrato que este arquivo segura:
//
//   · o id é o MESMO da presença (não nasce um segundo);
//   · o que não sabemos não vai — nem vazio, nem inventado;
//   · uma linha, até 128 caracteres;
//   · o que chega depois da construção entra no registrador vivo e reenvia
//     o REGISTER — se já estávamos registrados.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARQUIVO = join(ROOT, 'host/js/bravophone-aparelho.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const UUID = '3f2a9c1e-7b4d-4e8a-9f10-2c5d6e7f8a9b'

/**
 * Um `window` mínimo: a presença (de onde vem o id), o invólucro (de onde vêm
 * hostname e usuário) e um libwebphone de mentira que guarda a config e expõe
 * um registrador que anota o que recebeu.
 */
function montarAmbiente({ id = UUID, aparelho = undefined, registrado = true } = {}) {
  const timers = []
  const construidos = []
  const registrador = { extras: [], setExtraHeaders(l) { this.extras.push(l.slice()) } }
  const ua = {
    _registrado: registrado,
    registers: 0,
    registrator: () => registrador,
    isRegistered() { return this._registrado },
    register() { this.registers++ },
  }

  class Libwebphone {
    constructor(cfg) {
      this.cfg = cfg
      construidos.push(cfg)
      // O módulo userAgent do libwebphone: `_config` é o que um start()
      // futuro lê; `_userAgent` é a UA do JsSIP, que só existe após start().
      this._modulo = { _config: JSON.parse(JSON.stringify(cfg.userAgent || {})), _userAgent: null }
    }
    getUserAgent() { return this._modulo }
    start() { this._modulo._userAgent = ua }
  }
  Libwebphone.estatico = 'preservado'

  let deviceId = id
  const win = {
    console: { log() {}, warn() {}, error() {} },
    setInterval: (fn, ms) => { timers.push(fn); return timers.length },
    clearInterval: (n) => { timers[n - 1] = null },
    Date,
    Array,
    String,
    libwebphone: Libwebphone,
    __bpPresenca: { dispositivo: () => deviceId },
  }
  if (aparelho !== undefined) win.bravophoneNative = { plataforma: 'desktop-windows', aparelho }
  win.window = win

  vm.createContext(win)

  return {
    win,
    ua,
    registrador,
    construidos,
    rodar: async () => {
      vm.runInContext(await readFile(ARQUIVO, 'utf8'), win, { filename: 'bravophone-aparelho.js' })
    },
    /** O que o popup.js faz: constrói com a config dele e dá start(). */
    subirWebphone: () => {
      const inst = new win.libwebphone({
        userAgent: {
          user_agent: { instance_id: 'aleatorio-do-bundle', register: true },
          custom_headers: { establish_call: ['X-Outro: 1'] },
        },
      })
      inst.start()
      return inst
    },
    resolverId: (novo) => { deviceId = novo },
    correrTimers: () => { for (const fn of timers) if (fn) fn() },
  }
}

const cabecalho = (lista, nome) => (lista || []).find((h) => h.startsWith(nome + ': '))
const valor = (lista, nome) => { const h = cabecalho(lista, nome); return h ? h.slice(nome.length + 2) : undefined }

console.log('\naparelho — o módulo se instala sem tocar em nada que não seja seu:')
{
  const a = montarAmbiente()
  await a.rodar()
  check('publica __bpAparelho', typeof a.win.__bpAparelho === 'object')
  check('embrulha o construtor do libwebphone', a.win.libwebphone.__bpAparelho === true)
  check('preserva o prototype (instanceof continua valendo)',
    a.subirWebphone() instanceof a.win.libwebphone)
  check('não se instala duas vezes', (() => {
    const antes = a.win.libwebphone
    vm.runInContext('window.__bpAparelho && 0', a.win)
    return a.win.libwebphone === antes
  })())
}

console.log('\naparelho — extensão e página: só o id, e o id é o da presença:')
{
  const a = montarAmbiente({ aparelho: undefined })
  await a.rodar()
  const inst = a.subirWebphone()
  const ua = inst.cfg.userAgent
  const lista = ua.custom_headers.register
  check('X-Bravo-Device-Id vai com o UUID da presença', valor(lista, 'X-Bravo-Device-Id') === UUID, lista)
  check('o +sip.instance passa a ser o MESMO id', ua.user_agent.instance_id === UUID, ua.user_agent.instance_id)
  check('não inventa hostname', !cabecalho(lista, 'X-Bravo-Device-Hostname'), lista)
  check('não inventa usuário', !cabecalho(lista, 'X-Bravo-Device-User'), lista)
  check('o resto da config do bundle fica como estava',
    ua.custom_headers.establish_call[0] === 'X-Outro: 1' && ua.user_agent.register === true)
}

console.log('\naparelho — o invólucro sabe mais (Electron, Capacitor):')
{
  const a = montarAmbiente({ aparelho: { hostname: 'DESKTOP-JOAO01', usuario: 'joao.silva' } })
  await a.rodar()
  const lista = a.subirWebphone().cfg.userAgent.custom_headers.register
  check('hostname vai', valor(lista, 'X-Bravo-Device-Hostname') === 'DESKTOP-JOAO01', lista)
  check('usuário vai', valor(lista, 'X-Bravo-Device-User') === 'joao.silva', lista)
  check('os três, e nada mais', lista.length === 3, lista)
}

console.log('\naparelho — ausência é ausência:')
{
  const a = montarAmbiente({ aparelho: { hostname: '   ', usuario: null } })
  await a.rodar()
  const lista = a.subirWebphone().cfg.userAgent.custom_headers.register
  check('espaço em branco não vira cabeçalho', !cabecalho(lista, 'X-Bravo-Device-Hostname'), lista)
  check('null não vira cabeçalho', !cabecalho(lista, 'X-Bravo-Device-User'), lista)
  check('nenhum cabeçalho sai vazio', lista.every((h) => /: \S/.test(h)), lista)
}

console.log('\naparelho — uma linha, até 128 caracteres:')
{
  const longo = 'x'.repeat(200)
  const a = montarAmbiente({ aparelho: { hostname: ' MacBook\r\ndo João ', usuario: longo } })
  await a.rodar()
  const lista = a.subirWebphone().cfg.userAgent.custom_headers.register
  check('quebra de linha vira espaço (é cabeçalho SIP)',
    valor(lista, 'X-Bravo-Device-Hostname') === 'MacBook do João', valor(lista, 'X-Bravo-Device-Hostname'))
  check('corta em 128', valor(lista, 'X-Bravo-Device-User').length === 128)

  // Cortar por ponto de código: um emoji no limite não pode virar meio par.
  const b = montarAmbiente({ aparelho: { hostname: 'a'.repeat(127) + '😀' + 'b' } })
  await b.rodar()
  const h = valor(b.subirWebphone().cfg.userAgent.custom_headers.register, 'X-Bravo-Device-Hostname')
  check('não parte um emoji ao meio', Array.from(h).length === 128 && h.endsWith('😀'), h)
}

console.log('\naparelho — o que chega depois entra no registrador vivo:')
{
  const a = montarAmbiente({ aparelho: undefined })
  await a.rodar()
  const inst = a.subirWebphone()
  const ok = a.win.__bpAparelho.definir({ hostname: 'PC-RECEPCAO', user: 'maria' })
  check('definir() devolve true quando havia registrador', ok === true)
  const ultima = a.registrador.extras[a.registrador.extras.length - 1]
  check('o registrador recebe a lista nova', valor(ultima, 'X-Bravo-Device-Hostname') === 'PC-RECEPCAO', ultima)
  check('aceita `user` (SDK) como `usuario`', valor(ultima, 'X-Bravo-Device-User') === 'maria', ultima)
  check('o id continua na lista', valor(ultima, 'X-Bravo-Device-Id') === UUID, ultima)
  check('REGISTER reenviado na hora, porque já estávamos registrados', a.ua.registers === 1)
  check('a config do módulo também muda (um start() futuro lê dali)',
    valor(inst.getUserAgent()._config.custom_headers.register, 'X-Bravo-Device-Hostname') === 'PC-RECEPCAO')

  // null limpa; ausente não mexe.
  a.win.__bpAparelho.definir({ user: null })
  const depois = a.registrador.extras[a.registrador.extras.length - 1]
  check('null limpa o usuário', !cabecalho(depois, 'X-Bravo-Device-User'), depois)
  check('e não mexe no hostname', valor(depois, 'X-Bravo-Device-Hostname') === 'PC-RECEPCAO', depois)
}

console.log('\naparelho — sem registro ainda, não força um REGISTER:')
{
  const a = montarAmbiente({ registrado: false })
  await a.rodar()
  a.subirWebphone()
  a.win.__bpAparelho.definir({ hostname: 'X' })
  check('troca os cabeçalhos', a.registrador.extras.length === 1)
  check('mas deixa o primeiro REGISTER sair sozinho', a.ua.registers === 0)
}

console.log('\naparelho — antes do webphone existir, definir() não quebra:')
{
  const a = montarAmbiente()
  await a.rodar()
  let erro = null
  let r
  try { r = a.win.__bpAparelho.definir({ hostname: 'CEDO' }) } catch (e) { erro = e }
  check('não lança', erro === null, erro && erro.message)
  check('devolve false: não havia onde aplicar', r === false)
  const lista = a.subirWebphone().cfg.userAgent.custom_headers.register
  check('e o valor entra na construção que vem depois', valor(lista, 'X-Bravo-Device-Hostname') === 'CEDO', lista)
}

console.log('\naparelho — o id que chega depois (chrome.storage é assíncrono):')
{
  const a = montarAmbiente({ id: null })
  await a.rodar()
  const inst = a.subirWebphone()
  const ua = inst.cfg.userAgent
  check('sem id, não manda X-Bravo-Device-Id', !cabecalho(ua.custom_headers.register, 'X-Bravo-Device-Id'))
  check('e não inventa um: fica o instance_id do bundle', ua.user_agent.instance_id === 'aleatorio-do-bundle')
  check('nunca gera um segundo UUID (a identidade é da presença)',
    !a.win.__bpAparelho.identidade().id)

  a.resolverId(UUID)
  a.correrTimers()
  const ultima = a.registrador.extras[a.registrador.extras.length - 1]
  check('quando o id resolve, o cabeçalho vai para o registrador', valor(ultima, 'X-Bravo-Device-Id') === UUID, ultima)
  check('com um REGISTER agora', a.ua.registers === 1)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
