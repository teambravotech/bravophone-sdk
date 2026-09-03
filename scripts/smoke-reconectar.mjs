// O botão de presença: o que ele faz e o que ele mostra enquanto faz.
//
// POR QUE ESTE ARQUIVO EXISTE: o botão do bundle girava o ícone por 700 ms
// fixos e disparava uma ação que chama `api.bravophone.com` — backend
// aposentado quando o login foi para o Voxfree. O clique batia em
// ERR_NAME_NOT_RESOLVED, o `.catch` só tratava 429 e 401, e erro de DNS não
// tem `statusCode`: caía fora dos dois e não mostrava nada. A pessoa clicava,
// via um tremor, e o silêncio. Clicava de novo.
//
// Os dois defeitos eram independentes e o teste cobre os dois: a operação tem
// de ser a certa, e o giro tem de refletir a operação — começar quando ela
// começa e parar quando ela termina, não num prazo fixo.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = resolve(SDK, '..', 'Bravophone')
const ARQUIVO = join(EXT, 'js', 'bravophone-reconectar.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

check('o arquivo existe', existsSync(ARQUIVO))
const fonte = readFileSync(ARQUIVO, 'utf8')

/**
 * Monta um DOM mínimo e executa o script de verdade.
 *
 * `comRamal` decide o caminho: com ramal o botão re-registra; sem ramal ele
 * pergunta ao PABX. São queixas diferentes com respostas diferentes.
 */
function montar({ comRamal, registraEm = 0, consultaAcha = false }) {
  const classes = new Set()
  const ouvintes = {}
  const estado = { extension: comRamal ? { ramal: '2010' } : null, webphoneRegistered: false }
  let registrou = 0
  let consultou = 0

  const historico = []
  const corpo = {
    classList: {
      toggle: (c, on) => {
        if (on) { classes.add(c); historico.push(c) } else { classes.delete(c) }
      },
      contains: (c) => classes.has(c),
    },
  }

  const janela = {
    document: {
      body: corpo,
      getElementById: () => null,
      head: { appendChild() {} },
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {} }),
      addEventListener: (n, fn) => { (ouvintes[n] = ouvintes[n] || []).push(fn) },
    },
    addEventListener: (n, fn) => { (ouvintes[n] = ouvintes[n] || []).push(fn) },
    requestAnimationFrame: (fn) => { fn(); return 1 },
    // ESCALA, não achatamento. O produto sonda de 300 em 300ms e desiste em
    // 12s; achatar os dois para 5ms os fazia correr um contra o outro, e o
    // caso feliz piscava falha porque o prazo de desistência vencia junto.
    // Dividir por 100 encurta o teste e preserva a ordem, que é o que importa.
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round(ms / 100))),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, Math.max(1, Math.round(ms / 100))),
    clearInterval: (id) => clearInterval(id),
    CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail } },

    __bpWebphone: {
      getUserAgent: () => ({
        register() {
          registrou++
          // O registro não é instantâneo — é isso que o giro tem de esperar.
          // Relógio real de propósito: isto representa a REDE respondendo,
          // não um timer do código sob teste.
          if (registraEm >= 0) globalThis.setTimeout(() => { estado.webphoneRegistered = true }, registraEm)
        },
      }),
    },
    __bpSemRamal: Object.assign(() => true, {
      consultar: () => {
        consultou++
        if (consultaAcha) estado.extension = { ramal: '2011' }
        return Promise.resolve()
      },
    }),
  }
  janela.window = janela

  // O store, pelo caminho que os outros scripts usam.
  janela.document.getElementById = (id) => (id === 'app'
    ? { __vue_app__: { config: { globalProperties: { $store: { state: estado, commit() {} } } } } }
    : null)

  new Function('window', 'document', 'setTimeout', 'clearTimeout', 'setInterval',
    'clearInterval', 'requestAnimationFrame', 'console', fonte)(
    janela, janela.document, janela.setTimeout, janela.clearTimeout,
    janela.setInterval, janela.clearInterval, janela.requestAnimationFrame,
    { info() {}, warn() {} })

  return {
    janela, classes,
    // A piscada dura 900ms no produto e ~5ms aqui: olhar o estado final nao
    // serve. O historico diz se ela chegou a acontecer.
    piscou: (c) => historico.includes(c),
    registrou: () => registrou,
    consultou: () => consultou,
    clicar: () => janela.__bpReconectar.agora(),
  }
}

console.log('\nreconectar — com ramal, re-registra no SIP:')
{
  const t = montar({ comRamal: true, registraEm: 20 })
  check('reconhece que ha ramal', t.janela.__bpReconectar.temRamal() === true)

  t.clicar()
  check('gira assim que comeca', t.classes.has('bp-reconectando'))
  check('pediu o registro', t.registrou() === 1, t.registrou())
  check('e nao foi procurar ramal', t.consultou() === 0)

  // O GIRO ESPERA O REGISTRO ACONTECER, não o pedido sair. Era metade do
  // problema original: 700ms fixos param antes ou depois da operação, nunca
  // junto com ela.
  check('ainda girando enquanto o registro nao volta', t.classes.has('bp-reconectando'))
  await espera(120)
  check('parou de girar quando registrou', !t.classes.has('bp-reconectando'))
  check('e nao piscou falha', !t.piscou('bp-falhou'))
}

console.log('\nreconectar — o registro que nao volta pisca:')
{
  // registraEm negativo = nunca registra. O prazo interno cai para ~5ms neste
  // duplo, então o teste não espera 12 segundos.
  const t = montar({ comRamal: true, registraEm: -1 })
  t.clicar()
  await espera(260)
  check('parou de girar', !t.classes.has('bp-reconectando'))
  check('e piscou a falha', t.piscou('bp-falhou'))
}

console.log('\nreconectar — sem ramal, pergunta ao PABX:')
{
  const t = montar({ comRamal: false, consultaAcha: true })
  t.clicar()
  check('consultou o PABX', t.consultou() === 1)
  check('e nao tentou registrar', t.registrou() === 0)
  await espera(60)
  check('achou o ramal e nao piscou', !t.piscou('bp-falhou'))
}

console.log('\nreconectar — sem ramal e continua sem:')
{
  const t = montar({ comRamal: false, consultaAcha: false })
  t.clicar()
  await espera(60)
  // Perguntar e continuar sem ramal É uma tentativa frustrada, do ponto de
  // vista de quem clicou. Silêncio aqui seria a queixa original de volta.
  check('pisca quando ninguem atribuiu ramal', t.piscou('bp-falhou'))
}

console.log('\nreconectar — clique repetido nao empilha:')
{
  const t = montar({ comRamal: true, registraEm: 40 })
  t.clicar(); t.clicar(); t.clicar()
  check('so uma operacao em curso', t.registrou() === 1, t.registrou())
  check('e a trava se abre no fim', (await espera(140), !t.janela.__bpReconectar.ocupado()))
}

console.log('\nreconectar — o icone do ping acompanha a medicao:')
{
  const t = montar({ comRamal: true })
  const disparar = (estado) => {
    for (const fn of (t.janela.__ouvintes || [])) fn()
  }
  // O ouvinte foi registrado em window.addEventListener('bp:ping', ...).
  check('escuta o evento do ping', fonte.includes("addEventListener('bp:ping'"))
  check('gira enquanto mede', fonte.includes("estado === 'medindo'"))
  check('e pisca quando a medicao falha', fonte.includes("estado === 'falhou'"))
}

console.log('\nreconectar — nao mexe na arvore do Vue:')
{
  // Este projeto ja entrou em ciclo de recarga duas vezes por inserir no que o
  // Vue desenha. Aqui o estado e uma classe no body e o resto e CSS.
  check('nao insere nem move no', !/appendChild\(.*(pilula|botao|svg)/i.test(fonte))
  check('o estado vive numa classe do body', /body\.classList\.toggle/.test(fonte))
  check('intercepta na captura, para o clique nao chegar ao handler quebrado',
    fonte.includes('}, true)') && fonte.includes('ev.stopPropagation()'))
  check('respeita quem pediu menos movimento',
    fonte.includes('prefers-reduced-motion'))
}
console.log('\nsem-ramal — os quatro motivos do servidor:')
{
  const sr = readFileSync(join(EXT, 'js', 'bravophone-sem-ramal.js'), 'utf8')

  // O servidor tem QUATRO valores de `reason` (conferidos no server.js:
  // ok, credentials_not_available, no_extension_assigned, relogin_required).
  // Este arquivo tratava UM. Os outros tres caiam num if(hasExtension) que
  // adivinhava — e adivinhava errado no caso mais comum.
  for (const motivo of ['ok', 'credentials_not_available', 'no_extension_assigned', 'relogin_required']) {
    check('trata ' + motivo, sr.includes("'" + motivo + "'"))
  }

  // A ASSIMETRIA QUE IMPORTA: credentials_not_available cobre duas
  // situacoes opostas. Quem ja estava registrado continua falando (o
  // registro SIP vive no cliente, nao na API); quem recarregou a pagina nao
  // consegue registrar. Mesma resposta do servidor, e so o cliente sabe em
  // qual das duas esta.
  check('a credencial perdida consulta o registro local',
    /credentials_not_available[\s\S]{0,400}registradoAgora\(\)/.test(sr))
  check('e ha uma funcao que le webphoneRegistered',
    /function registradoAgora[\s\S]{0,220}webphoneRegistered/.test(sr))

  // Texto proprio: "atribuiram um ramal" e "voce perdeu o acesso ao que
  // tinha" mandam a pessoa para lugares diferentes — o administrador ou a
  // tela de login.
  check('a sessao caida tem texto proprio, nao o de ramal atribuido',
    /TXT_SESSAO_CAIU/.test(sr) && !/TXT_SESSAO_CAIU\s*=\s*TXT_RELOGIN/.test(sr))

  // Motivo novo do servidor nao pode virar tela em branco.
  check('motivo desconhecido cai no comportamento antigo',
    /rede de seguran/.test(sr) && /if \(st\.hasExtension\) esconderAvisoSemRamal\(\)/.test(sr))

  // Sem conseguir ler o store, esconder o aviso deixaria a pessoa sem
  // entender por que nao consegue ligar. O padrao seguro e MOSTRAR.
  check('sem acesso ao store, nao esconde o aviso',
    /catch \(e\) \{[\s\S]{0,220}return false/.test(sr))
}


console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
