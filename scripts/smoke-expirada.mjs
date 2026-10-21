// Sessão expirada: o que o webphone faz quando a API recusa o token.
//
// POR QUE ESTE ARQUIVO EXISTE: o 401 de `/api/pabx/extension`
// ("Sessão inválida ou expirada") era tratado em silêncio por cada módulo — o
// heartbeat parava, as rotas sumiam, o bundle limpava o storage sem avisar — e
// a tela continuava logada, sem direito a nada. O que a pessoa via era o
// registro SIP falhando para sempre e um toast de "ramal com dificuldades ao
// registrar" por tentativa, empilhados até cobrir o app.
//
// O que o teste fixa é o contrato inteiro do bravophone-sessao.js:
//   · 401 relatado vira PROVA antes de deslogar alguém (e 200 na prova é falso
//     alarme: ninguém sai do app por um soluço de servidor);
//   · provada, o aviso de registro cala e a pessoa recebe um diálogo;
//   · o OK apaga a sessão dos DOIS lugares ANTES de recarregar — a ordem que
//     não entra no loop de recargas do `unmounted`;
//   · ligação em curso não é interrompida por aviso nenhum;
//   · sessão injetada pelo integrador (SDK) espera a renovação antes de dizer
//     qualquer coisa.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { caminhoDaExtensao } from './extensao.mjs'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = caminhoDaExtensao()
const ARQUIVO = join(EXT, 'js', 'bravophone-sessao.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const espera = (ms) => new Promise((r) => setTimeout(r, ms))

check('o arquivo existe', existsSync(ARQUIVO))
const fonte = readFileSync(ARQUIVO, 'utf8')

/**
 * Monta um DOM mínimo e roda o script de verdade.
 *
 * `prova` é o que a rota canônica responde quando o módulo for conferir a
 * suspeita: 401 (morreu), 200 (falso alarme) ou 'rede' (sem resposta).
 */
function montar({
  prova = 401,
  emLigacao = false,
  injetada = false,
  comPonte = false,   // embutido no SDK, mas quem entrou foi a pessoa
  comContas = false,
  isLogged = true,
  tokenInicial = 'tok-velho',
  // O que atravessou o reload, e se a tela de login já está montada: é com
  // esses dois que se testa o recado do outro lado do recarregamento.
  recado = null,
  loginAberto = false,
} = {}) {
  const estado = {
    isLogged,
    callActive: emLigacao,
    callPhase: emLigacao ? 'active' : 'idle',
    webphoneRegistered: false,
  }

  const guardado = { bravophoneVxToken: tokenInicial, bravophoneRamal: '2010', bravophoneSip: 'x_2010' }
  const removidos = []
  const vuexLS = { user: { email: 'ana@exemplo.com' }, isLogged: true }
  const outrasLS = {}          // o resto do localStorage, a marca do token morto inclusive
  const sessionStore = recado ? { 'bp:sessao:expirou': recado } : {}
  let recarregou = 0
  let consultasDeProva = 0
  let caladoRegistro = null
  let acordou = 0
  const eventosHost = []
  const noCorpo = []           // elementos pendurados no <body>
  const classesCorpo = new Set()
  let telaDeLogin = loginAberto   // o `.login-screen` existe?

  function elemento() {
    const el = {
      filhos: [], ouvintes: {}, atributos: {}, classes: new Set(),
      className: '', innerHTML: '', textContent: '', style: {},
      focado: 0, removido: false,
    }
    el.classList = {
      add: (c) => el.classes.add(c),
      remove: (c) => el.classes.delete(c),
      contains: (c) => el.classes.has(c),
    }
    el.setAttribute = (k, v) => { el.atributos[k] = v }
    el.appendChild = (f) => { el.filhos.push(f); return f }
    el.addEventListener = (n, fn) => { (el.ouvintes[n] = el.ouvintes[n] || []).push(fn) }
    el.remove = () => { el.removido = true }
    el.focus = () => { el.focado++ }
    // O único querySelector em elemento é o do botão OK dentro do cartão.
    el.querySelector = (sel) => (sel === '.bps-ok' && el.innerHTML.includes('bps-ok') ? botaoOk : null)
    return el
  }

  const botaoOk = elemento()

  const corpo = {
    classList: {
      add: (c) => classesCorpo.add(c),
      remove: (c) => classesCorpo.delete(c),
      contains: (c) => classesCorpo.has(c),
    },
    appendChild: (el) => { noCorpo.push(el); return el },
  }

  const janela = {
    chrome: {
      i18n: { getMessage: () => '' },     // sem _locales: vale o texto de reserva
      storage: {
        local: {
          get: (chave, pronto) => {
            const k = Array.isArray(chave) ? chave : [chave]
            const r = {}
            k.forEach((x) => { if (guardado[x] !== undefined) r[x] = guardado[x] })
            setTimeout(() => pronto(r), 1)
          },
          remove: (chaves, pronto) => {
            chaves.forEach((k) => { delete guardado[k]; removidos.push(k) })
            setTimeout(() => pronto && pronto(), 1)
          },
        },
      },
    },
    localStorage: {
      getItem: (k) => (k === 'bravophone' ? JSON.stringify(vuexLS) : (outrasLS[k] ?? null)),
      setItem: (k, v) => {
        if (k === 'bravophone') Object.assign(vuexLS, JSON.parse(v))
        else outrasLS[k] = String(v)
      },
      removeItem: (k) => { delete outrasLS[k] },
    },
    sessionStorage: {
      getItem: (k) => (k in sessionStore ? sessionStore[k] : null),
      setItem: (k, v) => { sessionStore[k] = String(v) },
      removeItem: (k) => { delete sessionStore[k] },
    },
    location: { reload: () => { recarregou++ } },
    document: {
      body: corpo,
      head: { appendChild() {} },
      readyState: 'complete',
      getElementById: (id) => (id === 'app'
        ? { __vue_app__: { config: { globalProperties: { $store: { state: estado } } } } }
        : null),
      createElement: () => elemento(),
      querySelector: (sel) => (sel === '.login-screen' && telaDeLogin ? elemento() : null),
      addEventListener() {},
    },
    addEventListener() {},
    // Mesma escala do smoke-reconectar: /100 encurta sem trocar a ordem dos
    // acontecimentos (espera de renovação de 30s vira 300ms).
    setTimeout: (fn, ms) => setTimeout(fn, Math.max(1, Math.round((ms || 0) / 100))),
    clearTimeout: (id) => clearTimeout(id),
    setInterval: (fn, ms) => setInterval(fn, Math.max(1, Math.round((ms || 0) / 100))),
    clearInterval: (id) => clearInterval(id),

    __bpPresenca: { apiBase: () => 'https://pabx.exemplo' },
    __bpRegistro: {
      calar: (sim) => { caladoRegistro = sim !== false },
      acordar: () => { acordou++ },
    },
  }

  if (injetada) janela.__bpContasDesligadas = true
  if (injetada || comPonte) {
    janela.__bpBridge = { emit: (nome, carga) => eventosHost.push({ nome, carga }) }
  }

  if (comContas) {
    janela.__bpContas = {
      expirou: () => {
        // O que o módulo de contas faz de verdade: a conta fica sem sessão e
        // o storage nasce deslogado no próximo load.
        Object.keys(guardado).forEach((k) => { delete guardado[k]; removidos.push(k) })
        vuexLS.isLogged = false
        sessionStore['bp:contas:outra'] = 'senha:ana@exemplo.com'
        return Promise.resolve('ana@exemplo.com')
      },
    }
  }

  const buscar = (url, opcoes) => {
    consultasDeProva++
    if (prova === 'rede') return Promise.reject(new Error('sem rede'))
    return Promise.resolve({
      status: prova,
      ok: prova >= 200 && prova < 300,
      headers: { get: () => null },
      json: () => Promise.resolve({}),
      __url: url,
      __headers: opcoes && opcoes.headers,
    })
  }
  janela.window = janela
  janela.fetch = buscar

  new Function('window', 'document', 'chrome', 'fetch', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'console', fonte)(
    janela, janela.document, janela.chrome, buscar, janela.setTimeout, janela.clearTimeout,
    janela.setInterval, janela.clearInterval, { info() {}, warn() {}, log() {}, error() {} })

  const cartao = () => noCorpo.find((el) => el.atributos && el.atributos.role === 'alertdialog')

  return {
    janela,
    api: () => janela.__bpSessao,
    cartao,
    temCaixa: () => !!cartao(),
    texto: () => (cartao() ? cartao().innerHTML : ''),
    clicarOk: () => {
      const fns = botaoOk.ouvintes.click || []
      fns.forEach((fn) => fn({ preventDefault() {} }))
    },
    teclar: (key) => {
      const c = cartao()
      const fns = (c && c.ouvintes.keydown) || []
      let barrado = false
      fns.forEach((fn) => fn({ key, preventDefault() { barrado = true } }))
      return barrado
    },
    desligar: () => { estado.callActive = false; estado.callPhase = 'idle' },
    renovar: (t) => { guardado.bravophoneVxToken = t },
    abrirLogin: () => { telaDeLogin = true },
    avisoNoTopo: () => noCorpo.find((el) => el.className === 'bps-aviso'),
    // leituras
    provas: () => consultasDeProva,
    recarregou: () => recarregou,
    removidos: () => removidos,
    guardado: () => guardado,
    vuex: () => vuexLS,
    marcaDeMorte: () => outrasLS['bp:sessao:morta'],
    sessionStore: () => sessionStore,
    calado: () => caladoRegistro,
    acordou: () => acordou,
    eventos: () => eventosHost,
    classesCorpo: () => classesCorpo,
    tokenToastEscondido: () => classesCorpo.has('bps-expirou'),
  }
}

console.log('\nsessao expirada — o 401 vira prova antes de deslogar:')
{
  const t = montar({ prova: 401 })
  check('a API existe para quem precisa relatar', typeof t.api().suspeitar === 'function')
  t.api().suspeitar('ramal')
  await espera(30)
  check('conferiu com a rota canonica', t.provas() === 1, t.provas())
  check('e mostrou o aviso', t.temCaixa())
  check('com o titulo certo', t.texto().includes('Você foi desconectado'))
  check('explicando o motivo', t.texto().includes('Sua sessão expirou'))
  check('e um unico botao', t.texto().includes('bps-ok'))
  check('calou o aviso de registro', t.calado() === true)
  check('e escondeu os toasts que sobraram', t.tokenToastEscondido())
  // Nada foi apagado ANTES do OK: a pessoa ainda está vendo o app.
  check('nao apagou a sessao antes do OK', !!t.guardado().bravophoneVxToken)
  check('nem recarregou antes do OK', t.recarregou() === 0)
}

console.log('\nsessao expirada — 200 na prova e falso alarme:')
{
  const t = montar({ prova: 200 })
  t.api().suspeitar('rotas')
  await espera(30)
  check('conferiu', t.provas() === 1)
  check('e nao avisou ninguem', !t.temCaixa())
  check('nem calou o registro', t.calado() === null)
  check('a sessao segue de pe', !!t.guardado().bravophoneVxToken)
  check('e o estado volta a "viva"', t.api().estado().estado === 'viva')
}

console.log('\nsessao expirada — sem resposta nao desloga, mas insistencia sim:')
{
  const t = montar({ prova: 'rede' })
  t.api().suspeitar('ramal')
  await espera(20)
  check('rede fora nao desloga ninguem', !t.temCaixa())
  t.api().suspeitar('ramal')
  await espera(20)
  check('o segundo 401 tambem nao', !t.temCaixa())
  t.api().suspeitar('ramal')
  await espera(20)
  check('o terceiro 401 ja basta', t.temCaixa())
  check('depois de tentar provar tres vezes', t.provas() === 3, t.provas())
}

console.log('\nsessao expirada — o OK apaga a sessao e so entao recarrega:')
{
  const t = montar({ prova: 401 })
  t.api().suspeitar('ramal')
  await espera(30)
  t.clicarOk()
  // O OK lê o token, marca, limpa os dois lugares e só então recarrega: são
  // quatro voltas de promessa, e o relógio do Windows cobra por timer curto.
  await espera(150)
  check('apagou o vxToken do storage', !t.guardado().bravophoneVxToken)
  check('e o resto da sessao junto', t.removidos().includes('bravophoneSip'))
  check('desligou o isLogged do Vuex persistido', t.vuex().isLogged === false)
  check('e apagou o usuario de la', t.vuex().user === null)
  check('deixou o recado para a tela de login', t.sessionStore()['bp:sessao:expirou'] === '1')
  // A marca é do token, não da pessoa: é o que impede o srcdoc do SDK de
  // reinjetar a sessão recusada no reload (ver smoke-sessao.mjs).
  check('e marcou qual token morreu', t.marcaDeMorte() === 'tok-velho', t.marcaDeMorte())
  check('e recarregou', t.recarregou() === 1, t.recarregou())
  check('o aviso saiu da tela', !t.cartao() || t.cartao().removido)
}

console.log('\nsessao expirada — Enter e Escape valem pelo OK:')
{
  const t = montar({ prova: 401 })
  t.api().suspeitar('ramal')
  await espera(30)
  check('Tab nao escapa do unico botao', t.teclar('Tab'))
  t.teclar('Enter')
  await espera(150)
  check('Enter leva ao login', t.recarregou() === 1)
}

console.log('\nsessao expirada — com cadastro de contas, quem limpa e ele:')
{
  const t = montar({ prova: 401, comContas: true })
  t.api().suspeitar('ramal')
  await espera(30)
  t.clicarOk()
  // O OK lê o token, marca, limpa os dois lugares e só então recarrega: são
  // quatro voltas de promessa, e o relógio do Windows cobra por timer curto.
  await espera(150)
  check('a conta foi para o passo de senha', t.sessionStore()['bp:contas:outra'] === 'senha:ana@exemplo.com')
  check('a sessao sumiu', !t.guardado().bravophoneVxToken)
  check('e recarregou uma vez so', t.recarregou() === 1, t.recarregou())
}

console.log('\nsessao expirada — ninguem perde uma ligacao por causa de um aviso:')
{
  const t = montar({ prova: 401, emLigacao: true })
  t.api().suspeitar('ramal')
  await espera(30)
  check('o aviso espera a chamada terminar', !t.temCaixa())
  check('mas o registro ja esta calado', t.calado() === true)
  t.desligar()
  await espera(40)
  check('desligou, apareceu', t.temCaixa())
}

console.log('\nsessao expirada — sessao injetada pelo SDK espera a renovacao:')
{
  const t = montar({ prova: 401, injetada: true })
  t.api().suspeitar('ramal')
  await espera(30)
  check('segurou o aviso na tela', !t.temCaixa())
  // O SDK tem o proprio session:expired, depois que a renovacao falha. Dois
  // eventos para o mesmo fato — e o primeiro antes de a renovacao tentar —
  // faria integrador derrubar widget que ia voltar a funcionar.
  check('e nao falou nada ao integrador ainda', t.eventos().length === 0)
  t.renovar('tok-novo')
  await espera(60)
  check('token novo: nenhum aviso', !t.temCaixa())
  check('o registro volta a falar', t.calado() === false)
  check('e tenta registrar de novo', t.acordou() === 1, t.acordou())
  check('estado de volta a viva', t.api().estado().estado === 'viva')
}

console.log('\nsessao expirada — renovacao que nao vem acaba em aviso:')
{
  const t = montar({ prova: 401, injetada: true })
  t.api().suspeitar('ramal')
  // São 15 voltas de 2 s, que nesta escala viram 15 de 20 ms — com a folga que
  // o relógio do Windows cobra por timer curto.
  await espera(900)
  check('o aviso aparece quando ninguem renovou', t.temCaixa())
  check('e so entao o integrador fica sabendo',
    t.eventos().filter((e) => e.nome === 'session:expired').length === 1,
    JSON.stringify(t.eventos()))
}

console.log('\nsessao expirada — embutido, mas com login proprio, o host sabe na hora:')
{
  // Sem sessão injetada não há renovação de ninguém: o fato é definitivo, e o
  // integrador merece saber junto com a pessoa.
  const t = montar({ prova: 401, comPonte: true })
  t.api().suspeitar('ramal')
  await espera(30)
  const ev = t.eventos().find((e) => e.nome === 'session:expired')
  check('avisou o integrador', !!ev)
  check('dizendo o motivo', !!ev && /401/.test(ev.carga.reason))
  check('e mostrou o aviso na tela', t.temCaixa())
}

console.log('\nsessao expirada — na tela de login nao ha o que avisar:')
{
  const t = montar({ prova: 401, isLogged: false })
  t.api().suspeitar('ramal')
  await espera(30)
  check('sem aviso para quem ja esta deslogado', !t.temCaixa())
  check('e sem recarregar nada', t.recarregou() === 0)
}

console.log('\nsessao expirada — com a tela de login no ar, nao ha aviso a dar:')
{
  // Vale mesmo com o store dizendo "logado": um 401 chegando durante a carga
  // nao pode pousar um aviso em cima de quem ja esta digitando a senha.
  const t = montar({ prova: 401, loginAberto: true })
  t.api().suspeitar('ramal')
  await espera(30)
  check('a propria tela de login ja e a resposta', !t.temCaixa())
  check('e nada foi apagado', !!t.guardado().bravophoneVxToken)
}

console.log('\nsessao expirada — depois do reload, o login explica o motivo:')
{
  // O reload acontece entre duas cargas do script; o sessionStorage é o que
  // atravessa. Esta montagem nasce do outro lado dele: recado gravado, tela de
  // login no ar, sem sessão nenhuma.
  const t = montar({ prova: 200, isLogged: false, tokenInicial: null, recado: '1', loginAberto: true })
  await espera(30)
  const aviso = t.avisoNoTopo()
  check('a tela de login diz por que a pessoa esta ali', !!aviso)
  check('com o texto da expiracao', !!aviso && aviso.textContent.includes('Sua sessão expirou'))
  check('e o recado some depois de lido', t.sessionStore()['bp:sessao:expirou'] === undefined)
}

console.log('\nsessao expirada — sem o recado, a tela de login fica quieta:')
{
  const t = montar({ prova: 200, isLogged: false, tokenInicial: null, loginAberto: true })
  await espera(30)
  check('nenhum aviso sem motivo', !t.avisoNoTopo())
}

console.log(`\n${pass} ok, ${fail} falhou`)
process.exit(fail ? 1 : 0)
