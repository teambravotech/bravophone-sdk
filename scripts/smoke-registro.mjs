// O registro SIP: um aviso só por queda, e o socket órfão trocado.
//
// POR QUE ESTE ARQUIVO EXISTE: um cliente ficou com o ramal fora do ar e todo
// REGISTER voltando `404 "Rota nao cadastrada ou porta nao liberada no SBC"`.
// A credencial estava certa — sair e entrar resolvia na hora, com a MESMA url
// e a MESMA porta. O que mudava era a CONEXÃO: a central tinha reiniciado (o
// mesmo host respondeu 502 no HTTP minutos antes) e perdido a rota daquele
// socket, que continuou aberto deste lado. `connected: true` em 37 retratos
// seguidos do watchdog, e nenhum REGISTER passando.
//
// Nenhum dos caminhos de recuperação resolvia, porque todos re-REGISTRAM pelo
// mesmo socket — e `Transport.connect()` sozinho é no-op quando ele está vivo.
// O que o teste fixa é a saída: derrubar e subir a conexão, que é o gesto do
// sair-e-entrar sem perder a sessão.
//
// E fixa os freios, que importam tanto quanto: credencial recusada NÃO vira
// troca de socket, ligação em curso não é derrubada no meio, e central que
// reiniciou não é martelada.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = resolve(SDK, '..', 'Bravophone')
const ARQUIVO = join(EXT, 'js', 'bravophone-registro.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

check('o arquivo existe', existsSync(ARQUIVO))
const fonte = readFileSync(ARQUIVO, 'utf8')

/** Monta o mundo mínimo e roda o script de verdade. */
function montar({ conectado = true, emLigacao = false, escondido = false } = {}) {
  const estado = {
    webphoneRegistered: false,
    callActive: emLigacao,
    callPhase: emLigacao ? 'active' : 'idle',
  }
  const passos = []          // tudo o que foi feito no transporte, em ordem
  let registrou = 0

  const transporte = {
    connect: () => { passos.push('connect') },
    disconnect: () => { passos.push('disconnect') },
  }

  const jssip = {
    isConnected: () => conectado,
    _transport: transporte,
    _configuration: { uri: { host: 'sbc.exemplo' } },
    sendOptions: () => {},
  }

  const janela = {
    document: {
      visibilityState: escondido ? 'hidden' : 'visible',
      getElementById: (id) => (id === 'app'
        ? { __vue_app__: { config: { globalProperties: { $store: { state: estado } } } } }
        : null),
      addEventListener() {},
    },
    addEventListener() {},
    // Mesma escala dos outros smokes: /100 encurta sem trocar a ordem.
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round((ms || 0) / 100))),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, Math.max(1, Math.round((ms || 0) / 100))),
    clearInterval: (id) => clearInterval(id),
    __bpWebphone: {
      getUserAgent: () => ({
        isStarted: () => true,
        register: () => { registrou++ },
        _userAgent: jssip,
      }),
    },
  }
  janela.window = janela

  new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'console', fonte)(
    janela, janela.document, janela.setTimeout, janela.clearTimeout,
    janela.setInterval, janela.clearInterval, { info() {}, warn() {}, error() {} })

  const toast = { mostrou: 0 }
  return {
    api: () => janela.__bpRegistro,
    /** Uma recusa do SBC, como o bundle a entrega. */
    recusar: (status) => janela.__bpRegistro.falhou(
      () => { toast.mostrou++ },
      status ? { response: { status_code: status, reason_phrase: 'x' } } : {}),
    registrar: () => { estado.webphoneRegistered = true; janela.__bpRegistro.registrou() },
    desligar: () => { estado.callActive = false; estado.callPhase = 'idle' },
    passos: () => passos.join(','),
    reconstruiu: () => passos.filter((p) => p === 'disconnect').length,
    registrou: () => registrou,
    toast: () => toast.mostrou,
    estado: () => janela.__bpRegistro.estado(),
  }
}

console.log('\nregistro — o 404 do SBC troca o socket:')
{
  const t = montar()
  t.recusar(404)
  check('derrubou a conexao na hora', t.passos() === 'disconnect', t.passos())
  // Comparação exata de propósito: "disconnect" contém "connect", e um
  // includes() aqui passaria achando que reconectou junto.
  check('e ainda nao reconectou (o fechar e assincrono)', t.passos() === 'disconnect',
    t.passos())
  await espera(40)
  check('subiu de novo, na ordem certa', t.passos() === 'disconnect,connect', t.passos())
  check('contou a reconstrucao', t.estado().reconstrucoes === 1)
}

console.log('\nregistro — 5xx tambem e o outro lado, nao a senha:')
{
  const t = montar()
  t.recusar(503)
  await espera(40)
  check('reconstruiu no 503', t.passos() === 'disconnect,connect', t.passos())
}

console.log('\nregistro — credencial recusada NAO vira troca de socket:')
{
  // Trocar de socket com senha errada é trocar de nada: o 401/403 volta igual,
  // e o laço esconderia o problema real atrás de reconexões.
  for (const status of [401, 403, 407]) {
    const t = montar()
    t.recusar(status)
    await espera(40)
    check(`${status} nao reconstroi`, t.reconstruiu() === 0, t.passos())
  }
}

console.log('\nregistro — sem resposta, insiste antes de trocar:')
{
  // Falha sem resposta pode ser rede instável de quem está no cliente. Trocar
  // o socket na primeira seria barulho.
  const t = montar()
  t.recusar(null)
  await espera(20)
  check('a primeira falha nao reconstroi', t.reconstruiu() === 0)
  t.recusar(null)
  await espera(20)
  check('nem a segunda', t.reconstruiu() === 0)
  t.recusar(null)
  await espera(40)
  check('a terceira ja troca o socket', t.reconstruiu() === 1, t.passos())
}

console.log('\nregistro — ninguem derruba uma ligacao em curso:')
{
  // O socket carrega a sinalização: derrubá-lo no meio da chamada deixaria
  // ela sem como terminar (BYE, re-INVITE).
  const t = montar({ emLigacao: true })
  t.recusar(404)
  await espera(40)
  check('segura enquanto a linha esta ocupada', t.reconstruiu() === 0, t.passos())
  t.desligar()
  await espera(120)
  check('desligou, reconstruiu', t.passos() === 'disconnect,connect', t.passos())
}

console.log('\nregistro — central reiniciando nao e martelada:')
{
  const t = montar()
  t.recusar(404)
  await espera(40)
  check('primeira troca feita', t.reconstruiu() === 1)
  // A espera entre reconstruções conta em tempo real (0, 15s, 60s, 5min), e o
  // que importa aqui é que a segunda recusa, logo em seguida, NÃO troque de
  // novo. Uma central que voltou a responder 404 ainda está reiniciando.
  t.recusar(404)
  t.recusar(404)
  await espera(60)
  check('as recusas seguintes nao trocam de novo', t.reconstruiu() === 1, t.passos())
}

console.log('\nregistro — com o transporte caido, o caminho barato basta:')
{
  // Aqui não há socket órfão: reconectar já é o que o acordar() faz, e
  // derrubar o que já está no chão não tem sentido.
  const t = montar({ conectado: false })
  t.recusar(404)
  await espera(40)
  check('nao derrubou nada', t.passos() !== 'disconnect,connect' && t.passos().indexOf('disconnect') < 0, t.passos())
  check('so reconectou', t.passos() === 'connect', t.passos())
}

console.log('\nregistro — registrar zera a conta:')
{
  const t = montar()
  t.recusar(404)
  await espera(40)
  t.registrar()
  const e = t.estado()
  check('reconstrucoes zeradas', e.reconstrucoes === 0)
  check('falhas seguidas zeradas', e.falhasSeguidas === 0)
  check('e o aviso volta a ser possivel', e.mostrado === false)
}

console.log('\nregistro — sessao expirada cala tambem a reconstrucao:')
{
  // Sem sessão o ramal não vai registrar com socket nenhum: quem fala é o
  // bravophone-sessao.js, e insistir aqui seria ruído em cima de um aviso.
  const t = montar()
  t.api().calar(true)
  t.recusar(404)
  await espera(40)
  check('nao reconstroi calado', t.reconstruiu() === 0, t.passos())
  t.api().calar(false)
  t.recusar(404)
  await espera(40)
  check('e volta a reconstruir quando destravado', t.reconstruiu() === 1, t.passos())
}

console.log('\nregistro — um aviso por queda, nao um por tentativa:')
{
  // A queixa que deu origem ao módulo: seis toasts iguais cobrindo a tela.
  const t = montar()
  for (let i = 0; i < 6; i++) t.recusar(404)
  await espera(250)   // ESPERA_AVISO = 15 s, que nesta escala e 150 ms
  check('um toast, nao seis', t.toast() === 1, t.toast())
}

console.log(`\n${pass} ok, ${fail} falhou`)
process.exit(fail ? 1 : 0)
