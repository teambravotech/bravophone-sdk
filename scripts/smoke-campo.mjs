// Exercita o campo de discagem (js/bravophone-input.js) contra um DOM falso.
//
// POR QUE EXISTE: o display do bundle era uma <div>, então não havia cursor,
// seleção nem edição no meio. O arquivo troca aquilo por um <input> e passa a
// ser o dono da digitação — inclusive dos cliques no dialpad, que antes
// alimentavam a <div>.
//
// O DOM aqui é falso, mas o CONTRATO é o do navegador: ao digitar, o browser
// primeiro escreve em `value` e move o caret, e só depois dispara `input`. É
// nessa ordem que o teste digita, porque é aí que mora o bug clássico deste
// tipo de campo — reformatar o texto e deixar o cursor para trás.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ARQUIVO = join(ROOT, 'host/js/bravophone-input.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

// --- DOM falso -------------------------------------------------------------

/** style que registra a prioridade, como o CSSStyleDeclaration real. */
function criarStyle() {
  const s = { _imp: {} }
  s.setProperty = (k, v, p) => { s[k] = v; s._imp[k] = p === 'important' }
  s.removeProperty = (k) => { delete s[k]; delete s._imp[k] }
  return s
}

function criarNo(tag, classe = '') {
  const no = {
    tagName: tag.toUpperCase(),
    className: classe,
    style: criarStyle(),
    hidden: false,
    disabled: false,
    title: '',
    textContent: '',
    isConnected: true,
    offsetParent: {},
    _attrs: {},
    _lis: {},
    _filhos: {},
    addEventListener(t, fn) { (this._lis[t] = this._lis[t] || []).push(fn) },
    removeEventListener() {},
    setAttribute(k, v) { this._attrs[k] = String(v) },
    getAttribute(k) { return k in this._attrs ? this._attrs[k] : null },
    appendChild(c) { return c },
    remove() { this.isConnected = false },
    contains(o) { return o === this || Object.values(this._filhos).includes(o) },
    focus() { doc.activeElement = this },
    querySelector(sel) { return this._filhos[sel] || null },
    closest(sel) { return this.className.split(' ').includes(sel.replace('.', '')) ? this : null },
    classList: {
      // Idempotente, como o do navegador: pintar() chama toggle a cada
      // tecla e a versao ingenua repetia a classe.
      toggle(c, on) {
        const l = no.className.split(' ').filter(Boolean)
        const i = l.indexOf(c)
        if (on === undefined) on = i < 0
        if (on && i < 0) l.push(c)
        if (!on && i >= 0) l.splice(i, 1)
        no.className = l.join(' ')
      },
      contains(c) { return no.className.split(' ').includes(c) },
      add(c) { this.toggle(c, true) },
      remove(c) { this.toggle(c, false) },
    },
  }
  return no
}

function criarCampo() {
  const c = criarNo('input', 'bpi-campo')
  c.value = ''
  c.selectionStart = 0
  c.selectionEnd = 0
  c.scrollLeft = 0
  c.clientWidth = 200
  c.scrollWidth = 200
  c.placeholder = ''
  c.setSelectionRange = function (a, b) { this.selectionStart = a; this.selectionEnd = b }
  c.select = function () { this.selectionStart = 0; this.selectionEnd = this.value.length }
  return c
}

let doc = null

function disparar(no, tipo, extra = {}) {
  const ev = {
    type: tipo,
    target: extra.target || no,
    key: extra.key,
    ctrlKey: false, metaKey: false, altKey: false,
    defaultPrevented: false, propagouParou: false,
    preventDefault() { this.defaultPrevented = true },
    stopPropagation() { this.propagouParou = true },
    ...extra,
  }
  ;(no._lis[tipo] || []).forEach((fn) => fn(ev))
  return ev
}

/** Digita como o navegador: escreve, move o caret e SÓ ENTÃO avisa. */
function digitar(campo, texto) {
  for (const ch of texto) {
    const a = campo.selectionStart, b = campo.selectionEnd
    campo.value = campo.value.slice(0, a) + ch + campo.value.slice(b)
    campo.selectionStart = campo.selectionEnd = a + 1
    disparar(campo, 'input')
  }
}

async function montarAmbiente({ comWebphone = true } = {}) {
  const enviadas = []    // o que saiu por chrome.runtime.sendMessage
  const recebidas = []   // o que chegou aos listeners locais
  const chamadasUA = []  // userAgent.call(destino)
  const gravado = {}

  // A <div> que o bundle desenha, e o cabeçalho que vem antes dela.
  const alvo = criarNo('div', 'text-2xl font-semibold text-white tracking-wide')
  const cabecalho = criarNo('div', 'flex items-center justify-between mb-1')
  const pai = criarNo('div', 'relative')
  pai.insertBefore = () => {}
  alvo.parentNode = pai

  // Os nós que o innerHTML criaria. O arquivo é quem escreve esse markup, então
  // a lista aqui é o espelho dele.
  const campo = criarCampo()
  const filhos = {
    '.bpi-info': criarNo('span', 'bpi-info'),
    '.bpi-limpar': criarNo('button', 'bpi-limpar'),
    '.bpi-linha': criarNo('div', 'bpi-linha'),
    '.bpi-prefixo': criarNo('button', 'bpi-prefixo'),
    '.bpi-rotulo': criarNo('span', 'bpi-rotulo'),
    '.bpi-seta': criarNo('span', 'bpi-seta'),
    '.bpi-rolo': criarNo('div', 'bpi-rolo'),
    '.bpi-campo': campo,
    '.bpi-lista': criarNo('div', 'bpi-lista'),
  }
  filhos['.bpi-lista'].hidden = true

  // O botao de ligar do bundle: <button disabled><img src=answer-gray.png>
  const imgLigar = criarNo('img', 'call-answer')
  imgLigar._attrs.src = 'images/answer-gray.png'
  const btnLigar = criarNo('button', 'call-btn')
  btnLigar.disabled = true
  btnLigar.querySelector = (sel) => (sel.indexOf('answer') >= 0 ? imgLigar : null)
  imgLigar.closest = (sel) => {
    if (sel === 'button') return btnLigar
    if (sel.indexOf('answer') >= 0) return imgLigar
    return null
  }

  const estado = {
    callActive: false, callPhase: 'idle',
    dialDisplayNumber: '', dialNumberValid: false,
  }
  const commits = []
  // O commit precisa MUDAR o estado: o espelhamento só escreve quando o
  // que está no store difere do campo.
  const chaves = {
    setDialDisplayNumber: 'dialDisplayNumber',
    setDialNumberValid: 'dialNumberValid',
    setCallPhase: 'callPhase',
    setCallActive: 'callActive',
  }
  const vuex = {
    state: estado,
    commit: (k, v) => { commits.push([k, v]); if (chaves[k]) estado[chaves[k]] = v },
  }
  const appEl = { __vue_app__: { config: { globalProperties: { $store: vuex } } } }

  const docLis = {}
  doc = {
    activeElement: null,
    readyState: 'complete',
    visibilityState: 'visible',
    hasFocus: () => true,
    head: { appendChild() {} },
    body: {},
    createElement(tag) {
      const n = criarNo(tag)
      if (tag === 'div') {
        n._filhos = filhos
        n.previousElementSibling = cabecalho
        Object.defineProperty(n, 'innerHTML', { set() {}, get() { return '' } })
      }
      return n
    },
    getElementById(id) { return id === 'app' ? appEl : null },
    querySelectorAll(sel) {
      if (sel.indexOf('text-2xl') >= 0) return [alvo]
      if (sel.indexOf('answer') >= 0) return [imgLigar]
      if (sel === '#app *') return [statusEl]
      return []
    },
    querySelector() { return null },
    addEventListener(t, fn) { (docLis[t] = docLis[t] || []).push(fn) },
    removeEventListener() {},
  }

  const win = {
    document: doc,
    console: { log() {}, warn() {}, error() {} },
    // entregarLocal monta o `sender` com location.href.
    location: { href: 'http://host/popup.html' },
    setTimeout, clearTimeout, setInterval, clearInterval,
    MutationObserver: class {
      constructor(fn) { win.__redesenhou = fn }
      observe() {}
      disconnect() {}
    },
    chrome: {
      i18n: {
        getMessage: (k) => ({
          globalClear: 'Limpar',
          dialerBackspace: 'Apagar último',
          callStatusDialing: 'Chamando…',
        }[k] || ''),
      },
      storage: {
        local: {
          get: (k, cb) => cb && cb(gravado),
          set: (o, cb) => { Object.assign(gravado, o); cb && cb() },
        },
      },
      runtime: {
        id: 'ext',
        // O Chrome NAO entrega ao contexto que enviou; o campo guarda os
        // listeners na ida e entrega na mao. Aqui so registramos.
        onMessage: { addListener() {} },
        sendMessage: (m) => enviadas.push(m),
      },
    },
  }
  win.window = win

  // O userAgent e o unico caminho para um INVITE literal: o dialpad mapeia
  // letra em digito (T9), entao "joao" viraria "5626".
  const ua = { call: (d) => chamadasUA.push(d), setRedial() {} }
  // O texto da tela de chamada, que o Vue desenha a partir do i18n.
  const statusEl = criarNo('span', 'status')
  statusEl.textContent = 'Chamando…'
  statusEl.children = []
  const eventos = {}
  win.libwebphone = function () {
    return {
      getUserAgent: () => ua,
      on: (nome, fn) => { (eventos[nome] = eventos[nome] || []).push(fn) },
    }
  }

  vm.createContext(win)
  vm.runInContext(await readFile(ARQUIVO, 'utf8'), win)

  // O popup registra o listener e instancia o webphone DEPOIS do campo -
  // e por isso que ele carrega antes do popup.js.
  win.chrome.runtime.onMessage.addListener((msg) => recebidas.push(msg))
  if (comWebphone) new win.libwebphone({})

  return { win, doc, docLis, campo, filhos, alvo, cabecalho, gravado,
           enviadas, recebidas, chamadasUA, btnLigar, imgLigar, estado, commits,
           statusEl, eventos }
}

/** Clica numa opção da lista de prefixo. */
function escolher(amb, code) {
  disparar(amb.filhos['.bpi-lista'], 'click', {
    target: { closest: (s) => (s === '.bpi-opcao' ? { getAttribute: () => code } : null) },
  })
}

// --- os testes -------------------------------------------------------------

console.log('\ncampo — monta no lugar da <div> do bundle:')
{
  const a = await montarAmbiente()
  // O !important e obrigatorio: o Tailwind deste bundle marca TODAS as
  // utilitarias de display com !important, entao style inline
  // simples perde e o elemento continua ocupando espaco - o atributo diz
  // "none" e o computado diz "flex".
  check('escondeu o display antigo', a.alvo.style.display === 'none', a.alvo.style.display)
  check('e com !important, senão a classe .flex vence',
    a.alvo.style._imp.display === true)
  check('escondeu o cabeçalho antigo', a.cabecalho.style.display === 'none')
  check('o cabeçalho também com !important — é ele que tem class="flex"',
    a.cabecalho.style._imp.display === true)
  check('prefixo começa em +55', a.filhos['.bpi-rotulo'].textContent === '+55')
  check('botão limpar usa o texto do i18n', a.filhos['.bpi-limpar'].textContent === 'Limpar')
  check('limpar vis\u00edvel e desabilitado com o campo vazio',
    a.filhos['.bpi-limpar'].hidden === false &&
    a.filhos['.bpi-limpar'].disabled === true)
  check('focou de saída, sem exigir um clique', a.doc.activeElement === a.campo)
  check('avisou quem é o dono da digitação', typeof a.win.__bpInputCampo === 'function')
}

console.log('\ncampo — formata enquanto digita (regra do parsedInfo):')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19')
  check('DDD sozinho fica cru', a.campo.value === '19', a.campo.value)
  digitar(a.campo, '987654321')
  check('celular vira "19 98765-4321"', a.campo.value === '19 98765-4321', a.campo.value)

  const b = await montarAmbiente()
  digitar(b.campo, '1938271122')
  check('fixo vira "19 3827-1122"', b.campo.value === '19 3827-1122', b.campo.value)
}

console.log('\ncampo — o cursor não é perdido na reformatação:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19987654321')
  check('caret fica no fim depois de formatar',
    a.campo.selectionStart === a.campo.value.length,
    `${a.campo.selectionStart} de ${a.campo.value.length}`)

  // Editar no meio é justamente o que a <div> não permitia.
  const b = await montarAmbiente()
  digitar(b.campo, '1998765432')          // "19 98765-432"
  b.campo.selectionStart = b.campo.selectionEnd = 3   // logo depois do "19 "
  digitar(b.campo, '0')
  check('insere no meio e mantém o cursor junto do dígito novo',
    b.campo.value === '19 09876-5432' && b.campo.selectionStart === 4,
    `${b.campo.value} caret=${b.campo.selectionStart}`)
}

console.log('\ncampo — Backspace em cima do separador apaga o dígito:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '1998765')             // "19 98765"
  a.campo.selectionStart = a.campo.selectionEnd = 3   // "19 |98765"
  disparar(a.campo, 'keydown', { key: 'Backspace' })
  // Apaga o digito e o numero reagrupa: "19 98765" perde o 9 do DDD e os que
  // sobraram sobem, virando "19 8765". O cursor acompanha o digito, nao a
  // posicao no texto.
  check('apaga o dígito e o número reagrupa',
    a.campo.value === '19 8765' && a.campo.selectionStart === 1,
    `${a.campo.value} caret=${a.campo.selectionStart}`)
}

console.log('\ncampo — Ctrl+A pega só o campo:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '11999998888')
  const ev = disparar(a.campo, 'keydown', { key: 'a', ctrlKey: true })
  check('selecionou o conteúdo do campo',
    a.campo.selectionStart === 0 && a.campo.selectionEnd === a.campo.value.length)
  check('barrou o padrão do navegador', ev.defaultPrevented === true)
  check('não deixou subir para o webphone', ev.propagouParou === true)
}

console.log('\ncampo — discagem por número:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19987654321')
  disparar(a.campo, 'keydown', { key: 'Enter' })
  // Entregue na mao ao listener do proprio popup: o sendMessage do Chrome
  // nao volta para quem enviou, e o clique morria calado.
  check('chegou ao listener local', a.recebidas.length === 1,
    JSON.stringify(a.recebidas))
  check('pelo mesmo canal do click-to-call',
    a.recebidas[0] && a.recebidas[0].method === 'webphoneDialNow')
  check('com DDI, sem máscara', a.recebidas[0].payload.phone === '5519987654321',
    a.recebidas[0].payload.phone)
  check('e não saiu pelo sendMessage, que seria descartado',
    a.enviadas.length === 0, JSON.stringify(a.enviadas))

  const b = await montarAmbiente()
  digitar(b.campo, '5511988887777')
  disparar(b.campo, 'keydown', { key: 'Enter' })
  check('não duplica o 55 de quem já digitou o DDI',
    b.recebidas[0].payload.phone === '5511988887777', b.recebidas[0].payload.phone)

  const c = await montarAmbiente()
  disparar(c.campo, 'keydown', { key: 'Enter' })
  check('campo vazio não disca', c.recebidas.length === 0)
}

console.log('\ncampo — o modo usuário entra pela letra:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '1199')
  check('ainda é número', a.filhos['.bpi-rotulo'].textContent === '+55')
  digitar(a.campo, 'x')
  check('o prefixo vira @', a.filhos['.bpi-rotulo'].textContent === '@',
    a.filhos['.bpi-rotulo'].textContent)
  check('o chevron fica: o @ também é um seletor',
    a.filhos['.bpi-seta'].hidden === false)
  check('a linha de info explica o modo',
    a.filhos['.bpi-info'].textContent === 'Ligar para um usuário',
    a.filhos['.bpi-info'].textContent)
  check('para de formatar', a.campo.value === '1199x', a.campo.value)

  disparar(a.campo, 'keydown', { key: 'Enter' })
  // Direto no userAgent. Pelo caminho normal o dialpad mapearia as letras
  // em dígitos (T9) e a ligação sairia para outro número, calada.
  check('manda o texto EXATAMENTE como está, pelo userAgent',
    a.chamadasUA[0] === '1199x', a.chamadasUA[0])
  check('e não pelo canal de número', a.recebidas.length === 0)

  // Apagar a letra tem de devolver o campo ao mundo dos números.
  const b = await montarAmbiente()
  digitar(b.campo, '19a')
  b.campo.value = '19987654321'
  b.campo.selectionStart = b.campo.selectionEnd = 11
  disparar(b.campo, 'input')
  check('tirar a letra volta a formatar', b.campo.value === '19 98765-4321', b.campo.value)
  check('e devolve o +55', b.filhos['.bpi-rotulo'].textContent === '+55')
}

console.log('\ncampo — linha de info, a mesma do bundle:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '199876')
  check('não adivinha com menos de 10 dígitos', a.filhos['.bpi-info'].textContent === '',
    a.filhos['.bpi-info'].textContent)
  digitar(a.campo, '54321')
  check('mostra a cidade do DDD',
    a.filhos['.bpi-info'].textContent.indexOf('Campinas (19)') >= 0,
    a.filhos['.bpi-info'].textContent)

  const b = await montarAmbiente()
  digitar(b.campo, '1099999999')
  check('DDD inexistente não inventa cidade', b.filhos['.bpi-info'].textContent === '',
    b.filhos['.bpi-info'].textContent)
}

console.log('\ncampo — troca de país:')
{
  const a = await montarAmbiente()
  disparar(a.filhos['.bpi-prefixo'], 'click')
  check('a lista abre', a.filhos['.bpi-lista'].hidden === false)
  check('marca o prefixo como expandido',
    a.filhos['.bpi-prefixo'].getAttribute('aria-expanded') === 'true')

  disparar(a.filhos['.bpi-lista'], 'click', {
    target: { closest: (s) => (s === '.bpi-opcao' ? { getAttribute: () => '+351' } : null) },
  })
  check('o prefixo passa a +351', a.filhos['.bpi-rotulo'].textContent === '+351',
    a.filhos['.bpi-rotulo'].textContent)
  check('a lista fecha', a.filhos['.bpi-lista'].hidden === true)
  check('a escolha fica gravada', a.gravado.bravophoneInputDdi === '+351',
    JSON.stringify(a.gravado))

  digitar(a.campo, '912345678')
  check('fora do Brasil não agrupa em DDD', a.campo.value === '912345678', a.campo.value)
  disparar(a.campo, 'keydown', { key: 'Enter' })
  check('disca com o DDI escolhido',
    a.recebidas[0].payload.phone === '351912345678', a.recebidas[0].payload.phone)
}

console.log('\ncampo — as reticências acompanham o scroll:')
{
  const a = await montarAmbiente()
  const mascara = () => a.filhos['.bpi-rolo'].style.maskImage || ''

  a.campo.scrollWidth = 200; a.campo.scrollLeft = 0
  digitar(a.campo, '1')
  check('texto que cabe não desbota nada',
    mascara().indexOf('transparent') < 0, mascara())

  a.campo.scrollWidth = 400; a.campo.scrollLeft = 0
  disparar(a.campo, 'scroll')
  check('sobra à direita: desbota só a direita',
    mascara().indexOf('calc(100% - 22px),transparent') >= 0 &&
    mascara().indexOf('transparent 0') < 0, mascara())

  a.campo.scrollLeft = 200
  disparar(a.campo, 'scroll')
  check('no fim: desbota só a esquerda',
    mascara().indexOf('transparent 0') >= 0 &&
    mascara().indexOf('transparent 100%') < 0, mascara())

  a.campo.scrollLeft = 100
  disparar(a.campo, 'scroll')
  check('no meio: desbota dos dois lados',
    mascara().indexOf('transparent 0') >= 0 &&
    mascara().indexOf('transparent 100%') >= 0, mascara())
}

console.log('\ncampo — foco inteligente:')
{
  const a = await montarAmbiente()
  a.doc.activeElement = null
  const ev = disparar({ _lis: { keydown: a.docLis.keydown } }, 'keydown', {
    key: '7', target: { tagName: 'DIV', isContentEditable: false },
  })
  check('digitar fora do campo traz o foco', a.doc.activeElement === a.campo)
  check('e NÃO perde a tecla', a.campo.value === '7', a.campo.value)
  check('consumiu o evento', ev.defaultPrevented === true)

  // Quem está escrevendo em outro lugar não pode ser interrompido.
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    const b = await montarAmbiente()
    b.doc.activeElement = null
    disparar({ _lis: { keydown: b.docLis.keydown } }, 'keydown', {
      key: '5', target: { tagName: tag, isContentEditable: false },
    })
    check(`não rouba o foco de um <${tag.toLowerCase()}>`, b.campo.value === '', b.campo.value)
  }

  const c = await montarAmbiente()
  c.doc.activeElement = null
  disparar({ _lis: { keydown: c.docLis.keydown } }, 'keydown', {
    key: '5', target: { tagName: 'DIV', isContentEditable: true },
  })
  check('nem de um contenteditable', c.campo.value === '')

  const d = await montarAmbiente()
  d.doc.activeElement = null
  disparar({ _lis: { keydown: d.docLis.keydown } }, 'keydown', {
    key: 'Tab', target: { tagName: 'DIV' },
  })
  check('Tab continua navegando', d.doc.activeElement === null && d.campo.value === '')

  const e = await montarAmbiente()
  e.doc.activeElement = null
  disparar({ _lis: { keydown: e.docLis.keydown } }, 'keydown', {
    key: 'c', ctrlKey: true, target: { tagName: 'DIV' },
  })
  check('Ctrl+C não vira digitação', e.campo.value === '')
}

console.log('\ncampo — o dialpad na tela escreve no campo:')
{
  const a = await montarAmbiente()
  const botao = { textContent: '2ABC', closest: (s) => (s === '.keypad button' ? botao : null) }
  const ev = disparar({ _lis: { click: a.docLis.click } }, 'click', {
    target: { closest: (s) => (s === '.keypad button' ? botao : null) },
  })
  check('o clique vira dígito no campo', a.campo.value === '2', a.campo.value)
  check('e não chega ao handler do bundle',
    ev.defaultPrevented === true && ev.propagouParou === true)

  // Escreve na posição do cursor, não sempre no fim.
  const b = await montarAmbiente()
  digitar(b.campo, '1199')
  b.campo.selectionStart = b.campo.selectionEnd = 0
  const b7 = { textContent: '7PQRS', closest: () => b7 }
  disparar({ _lis: { click: b.docLis.click } }, 'click', { target: { closest: () => b7 } })
  check('respeita onde o cursor está',
    b.campo.value === '71 199' && b.campo.selectionStart === 1,
    `${b.campo.value} caret=${b.campo.selectionStart}`)

  const c = await montarAmbiente()
  const outro = { textContent: 'Ligar', closest: () => outro }
  disparar({ _lis: { click: c.docLis.click } }, 'click', { target: { closest: () => outro } })
  check('botão que não é tecla passa direto', c.campo.value === '')
}

console.log('\ncampo — limpar:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '11987654321')
  check('o botão habilita quando há o que apagar',
    a.filhos['.bpi-limpar'].disabled === false)
  disparar(a.filhos['.bpi-limpar'], 'click')
  check('esvaziou', a.campo.value === '')
  check('e desabilita de novo', a.filhos['.bpi-limpar'].disabled === true)
  check('devolveu o foco', a.doc.activeElement === a.campo)

  const b = await montarAmbiente()
  digitar(b.campo, '11a')
  disparar(b.campo, 'keydown', { key: 'Escape' })
  check('Escape limpa e sai do modo usuário',
    b.campo.value === '' && b.filhos['.bpi-rotulo'].textContent === '+55')
}

console.log('\ncampo — o vão vazio acima do número:')
{
  const a = await montarAmbiente()
  check('o cabeçalho do bundle começa escondido',
    a.cabecalho.style.display === 'none')

  // O Vue redesenha essa area e leva junto o style inline. Sem reaplicar, as
  // duas faixas somam e abrem um vao vazio acima do numero.
  a.cabecalho.style.removeProperty('display')
  a.win.__redesenhou()
  check('e volta a ficar escondido depois de um redesenho',
    a.cabecalho.style.display === 'none' && a.cabecalho.style._imp.display === true,
    a.cabecalho.style.display)
}

console.log('\ncampo — o @ leva a cor da marca:')
{
  const a = await montarAmbiente()
  check('número: sem a classe de cor',
    !a.filhos['.bpi-rotulo'].className.includes('bpi-marca'),
    a.filhos['.bpi-rotulo'].className)
  digitar(a.campo, 'joao')
  check('usuário: o @ ganha a classe da marca',
    a.filhos['.bpi-rotulo'].className.includes('bpi-marca'),
    a.filhos['.bpi-rotulo'].className)
  check('e a linha entra em modo usuário, levando o cursor junto',
    a.filhos['.bpi-linha'].classList.contains('usuario'),
    a.filhos['.bpi-linha'].className)

  disparar(a.campo, 'keydown', { key: 'Escape' })
  check('sair do modo tira as duas classes',
    !a.filhos['.bpi-rotulo'].className.includes('bpi-marca') &&
    !a.filhos['.bpi-linha'].classList.contains('usuario'))
}

console.log('\ncampo — o seletor troca o modo, não só o país:')
{
  const a = await montarAmbiente()
  disparar(a.filhos['.bpi-prefixo'], 'click')
  const html = a.filhos['.bpi-lista'].innerHTML
  check('a opção de usuário não tem separador nem ícone',
    html.indexOf('bpi-risco') < 0 && html.indexOf('>Usuário<') >= 0,
    html.slice(0, 140))
  check('o usuário é a primeira opção da lista',
    html.indexOf('data-code="@"') >= 0 &&
    html.indexOf('data-code="@"') < html.indexOf('data-code="+55"'), html.slice(0, 90))

  // Um ramal é só dígitos: sem esta opção não havia como discá-lo literalmente.
  escolher(a, '@')
  check('escolher @ entra em modo usuário sem precisar de letra',
    a.filhos['.bpi-rotulo'].textContent === '@')
  digitar(a.campo, '1001')
  check('e os dígitos NÃO voltam a virar telefone',
    a.campo.value === '1001' && a.filhos['.bpi-rotulo'].textContent === '@',
    `${a.campo.value} ${a.filhos['.bpi-rotulo'].textContent}`)
  disparar(a.campo, 'keydown', { key: 'Enter' })
  check('disca o ramal como está', a.chamadasUA[0] === '1001', a.chamadasUA[0])
}

console.log('\ncampo — e volta para o telefone mesmo com texto no campo:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '11joao98')
  check('a letra levou para o modo usuário', a.filhos['.bpi-rotulo'].textContent === '@')

  escolher(a, '+55')
  check('voltou para +55', a.filhos['.bpi-rotulo'].textContent === '+55')
  // "+55" quer dizer "isto é um número": o que não é dígito não tem como ficar.
  check('as letras saem e o que sobra vira telefone', a.campo.value === '11 98',
    a.campo.value)

  // O modo fica preso — senão a próxima letra desfazia a escolha na hora.
  digitar(a.campo, '7654321')
  check('digitar números não desfaz a escolha',
    a.filhos['.bpi-rotulo'].textContent === '+55' && a.campo.value === '11 98765-4321',
    `${a.campo.value} ${a.filhos['.bpi-rotulo'].textContent}`)

  // Mas uma letra solta o modo: um campo que recusa letras parece quebrado.
  digitar(a.campo, 'x')
  check('uma letra solta o modo preso', a.filhos['.bpi-rotulo'].textContent === '@',
    a.filhos['.bpi-rotulo'].textContent)
}

console.log('\ncampo — limpar devolve a decisão ao campo:')
{
  const a = await montarAmbiente()
  escolher(a, '@')
  disparar(a.filhos['.bpi-limpar'], 'click')
  check('sai do modo usuário', a.filhos['.bpi-rotulo'].textContent === '+55')
  digitar(a.campo, '11987654321')
  check('e volta a decidir sozinho', a.campo.value === '11 98765-4321', a.campo.value)
}

console.log('\ncampo — o seletor não pode ser confundido com o botão de ligar:')
{
  // O bravophone-sem-ramal.js reconhece o botão de discar por SUBSTRING do
  // title (o texto de webphoneCallMake, "Ligar"). Um title nosso que dissesse
  // "ligar para um usuário" fazia o clique no seletor virar o banner de
  // "nenhum ramal atribuído" piscando, e a lista nunca abria.
  const a = await montarAmbiente()
  const proibido = (t) => (t || '').toLowerCase().includes('ligar')

  check('title do seletor não contém "ligar" (modo número)',
    !proibido(a.filhos['.bpi-prefixo'].title), a.filhos['.bpi-prefixo'].title)

  digitar(a.campo, 'joao')
  check('nem no modo usuário',
    !proibido(a.filhos['.bpi-prefixo'].title), a.filhos['.bpi-prefixo'].title)

  check('e o seletor nunca fica desabilitado',
    a.filhos['.bpi-prefixo'].disabled === false)
}

// canDial(){ return !!this.dialDisplayNumber && this.dialNumberValid } — é o
// ESTADO do store que acende o botão, não o histórico de commits: o
// espelhamento só escreve quando o valor difere, então pode não haver commit
// nenhum e ainda assim o estado estar certo.
const valido = (amb) => amb.estado.dialNumberValid
const espelhado = (amb) => amb.estado.dialDisplayNumber

/** Um botão do bundle, fora do nosso wrap. */
function botaoDoBundle(classe, titulo) {
  const b = {
    tagName: 'BUTTON', className: classe, textContent: '',
    getAttribute: (k) => (k === 'title' ? (titulo || null) : null),
  }
  b.closest = (sel) => (sel === 'button' ? b : null)
  return b
}

function clicarNoBundle(amb, btn) {
  return disparar({ _lis: { click: amb.docLis.click } }, 'click',
    { target: { closest: (sel) => btn.closest(sel) } })
}

console.log('\ncampo — o botão verde é aceso pelo store, não na marra:')
{
  // canDial(){ return !!this.dialDisplayNumber && this.dialNumberValid } — os
  // dois vêm do store, então commitar os dois acende o botão pela própria
  // reatividade do app.
  const a = await montarAmbiente()
  digitar(a.campo, '1998765')
  check('número pela metade: inválido', valido(a) === false)

  digitar(a.campo, '4321')
  check('celular completo: válido', valido(a) === true)
  check('e o número chega ao store', espelhado(a) === '19 98765-4321', espelhado(a))

  // Era aqui que quebrava: commitando '' o canDial ficava falso e o botão de
  // apagar, que só renderiza sob dialDisplayNumber, sumia junto.
  const b = await montarAmbiente()
  escolher(b, '@')
  digitar(b.campo, 'joao')
  check('modo usuário: válido', valido(b) === true)
  check('e o texto chega ao store, não vazio', espelhado(b) === 'joao', espelhado(b))
}

console.log('\ncampo — o clique nos botões do bundle:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19987654321')
  const ev = clicarNoBundle(a, botaoDoBundle('dial-btn rounded-full', 'Ligar'))
  check('clicar em Ligar disca daqui',
    a.recebidas.length === 1 && a.recebidas[0].payload.phone === '5519987654321',
    JSON.stringify(a.recebidas))
  check('e não deixa o handler do bundle rodar',
    ev.defaultPrevented === true && ev.propagouParou === true)

  // O backspace do bundle tira de callNumber, que está vazio: sem isto o
  // botão não fazia nada.
  clicarNoBundle(a, botaoDoBundle('p-2', 'Apagar último'))
  // Cai de 11 para 10 digitos, entao reagrupa como fixo - "19 98765-4321"
  // vira "19 9876-5432". O numero e o mesmo menos o ultimo digito.
  check('o botão de apagar apaga do campo', a.campo.value === '19 9876-5432',
    a.campo.value)

  // Pulando o separador: senão a tecla parece travada.
  const b = await montarAmbiente()
  digitar(b.campo, '1998765')
  b.campo.selectionStart = b.campo.selectionEnd = 3
  clicarNoBundle(b, botaoDoBundle('p-2', 'Apagar último'))
  check('apagar em cima do separador tira o dígito', b.campo.value === '19 8765',
    b.campo.value)

  const c = await montarAmbiente()
  escolher(c, '@')
  digitar(c.campo, 'joao')
  clicarNoBundle(c, botaoDoBundle('p-2', 'Apagar último'))
  check('e funciona no modo usuário', c.campo.value === 'joa', c.campo.value)
}

console.log('\ncampo — o que conta como número válido:')
{
  const casos = [
    ['11987654321', true,  'celular com DDD'],
    ['1133334444',  true,  'fixo com DDD'],
    ['1187654321',  false, 'celular sem o 9'],
    ['0099999999',  false, 'DDD que não existe'],
    ['119876543',   false, 'dígitos de menos'],
    ['1001',        true,  'ramal de 4 dígitos'],
    ['*123',        true,  'código de facilidade'],
  ]
  for (const [entrada, esperado, nome] of casos) {
    const a = await montarAmbiente()
    digitar(a.campo, entrada)
    check(`${nome}: ${esperado ? 'válido' : 'inválido'}`,
      valido(a) === esperado, `"${a.campo.value}"`)
  }

  // Ramal não leva DDI: prefixar +55 manda a chamada para a rua.
  const r = await montarAmbiente()
  digitar(r.campo, '1001')
  disparar(r.campo, 'keydown', { key: 'Enter' })
  check('o ramal é discado cru', r.recebidas[0].payload.phone === '1001',
    r.recebidas[0].payload.phone)
}

console.log('\ncampo — nome de usuário também é validado:')
{
  const casos = [
    ['joao.silva', true,  'nome comum'],
    ['ramal_1001', true,  'com underline'],
    ['a',          false, 'curto demais'],
    ['joao silva', false, 'com espaço quebraria o INVITE'],
    ['joao@x.com', false, 'com @ mudaria o domínio de destino'],
    ['.joao',      false, 'começando com pontuação'],
  ]
  for (const [entrada, esperado, nome] of casos) {
    const a = await montarAmbiente()
    escolher(a, '@')
    a.campo.value = entrada
    a.campo.selectionStart = a.campo.selectionEnd = entrada.length
    disparar(a.campo, 'input')
    check(`${nome}: ${esperado ? 'válido' : 'inválido'}`,
      valido(a) === esperado, `"${a.campo.value}"`)
  }
}

console.log('\ncampo — sem webphone, usuário não acende (em vez de discar errado):')
{
  // Sem userAgent o único caminho seria o dialpad, que faria "joao" virar
  // "5626". Ligação errada é pior que ligação nenhuma.
  const a = await montarAmbiente({ comWebphone: false })
  escolher(a, '@')
  digitar(a.campo, 'joao')
  check('não fica válido', valido(a) === false)
  disparar(a.campo, 'keydown', { key: 'Enter' })
  check('e não disca por nenhum caminho',
    a.chamadasUA.length === 0 && a.recebidas.length === 0)

  // Número continua normal: ele não depende do userAgent.
  const b = await montarAmbiente({ comWebphone: false })
  digitar(b.campo, '11987654321')
  check('número segue funcionando', valido(b) === true)
}

console.log('\ncampo — durante a chamada, tudo volta a ser do bundle:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '11987654321')
  a.estado.callActive = true

  // Cada tecla vira DTMF, e quem manda DTMF é o bundle.
  const antes = a.campo.value
  const b5 = { textContent: '5JKL', closest: () => b5 }
  const ev = disparar({ _lis: { click: a.docLis.click } }, 'click',
    { target: { closest: (sel) => (sel === '.keypad button' ? b5 : null) } })
  check('não engole a tecla do dialpad',
    a.campo.value === antes && ev.defaultPrevented === false, a.campo.value)

  // E o verde agora é desligar/atender: encostar seria sequestrar a chamada.
  a.recebidas.length = 0
  clicarNoBundle(a, botaoDoBundle('dial-btn rounded-full', 'Ligar'))
  check('não rouba o clique do botão verde', a.recebidas.length === 0)
}

/** Dispara um evento do libwebphone, como o próprio emissor faria. */
function sipEvento(amb, nome, ...args) {
  ;(amb.eventos[nome] || []).forEach((fn) => fn(...args))
}

console.log('\ncampo — LIGANDO até o 180, CHAMANDO depois:')
{
  // O bundle só tem "dialing" da saída do INVITE até o atendimento: quem
  // olha a tela não sabe se o outro lado já está tocando.
  const a = await montarAmbiente()
  a.estado.callPhase = 'dialing'
  a.win.__redesenhou()
  check('sem resposta ainda: LIGANDO', a.statusEl.textContent === 'LIGANDO…',
    a.statusEl.textContent)

  // 100 Trying nem chega aqui: o JsSIP só emite progress para os demais 1xx.
  sipEvento(a, 'call.progress', {}, {}, { originator: 'remote', response: { status_code: 180 } })
  check('180 Ringing: CHAMANDO', a.statusEl.textContent === 'CHAMANDO…',
    a.statusEl.textContent)

  // O Vue redesenha e reescreve o texto do i18n; reescrevemos de volta.
  a.statusEl.textContent = 'Chamando…'
  a.win.__redesenhou()
  check('aguenta o redesenho', a.statusEl.textContent === 'CHAMANDO…',
    a.statusEl.textContent)

  // A próxima chamada começa do zero.
  sipEvento(a, 'call.ended')
  check('a chamada seguinte volta a LIGANDO',
    a.statusEl.textContent === 'LIGANDO…', a.statusEl.textContent)
}

console.log('\ncampo — o status só é nosso na chamada de saída:')
{
  const a = await montarAmbiente()
  a.estado.callPhase = 'ringing'   // no bundle isso é chamada RECEBIDA
  a.win.__redesenhou()
  check('não mexe em "Recebendo chamada"',
    a.statusEl.textContent === 'Chamando…', a.statusEl.textContent)

  const b = await montarAmbiente()
  b.estado.callPhase = 'connected'
  b.win.__redesenhou()
  check('nem no atendido', b.statusEl.textContent === 'Chamando…',
    b.statusEl.textContent)
}

console.log('\ncampo — um 1xx que não é toque não adianta o texto:')
{
  const a = await montarAmbiente()
  a.estado.callPhase = 'dialing'
  a.win.__redesenhou()
  sipEvento(a, 'call.progress', {}, {}, { response: { status_code: 100 } })
  check('100 Trying continua LIGANDO', a.statusEl.textContent === 'LIGANDO…',
    a.statusEl.textContent)

  // 183 costuma trazer o ringback: para quem olha a tela, é a mesma coisa.
  sipEvento(a, 'call.progress', {}, {}, { response: { status_code: 183 } })
  check('183 Session Progress vira CHAMANDO',
    a.statusEl.textContent === 'CHAMANDO…', a.statusEl.textContent)
}

console.log('\ncampo — depois da chamada o botão volta sozinho:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19987654321')
  check('válido antes de ligar', valido(a) === true)

  // Ligou e desligou: o clearWebphone do bundle zera o store, mas o número
  // continua na tela. Sem reespelhar, o botão só voltava quando o usuário
  // mexia em alguma tecla.
  a.estado.callPhase = 'dialing'
  a.win.__redesenhou()
  a.estado.callPhase = 'idle'
  a.estado.dialDisplayNumber = ''
  a.estado.dialNumberValid = false
  a.win.__redesenhou()

  check('o número volta ao store', espelhado(a) === '19 98765-4321', espelhado(a))
  check('e o botão volta a acender', valido(a) === true)
  check('o campo não perdeu o número', a.campo.value === '19 98765-4321',
    a.campo.value)
}

console.log('\ncampo — durante a chamada o store é do bundle:')
{
  const a = await montarAmbiente()
  digitar(a.campo, '19987654321')
  a.estado.callActive = true
  // Quem sabe o que está no ar é o bundle; não escrevemos por cima.
  a.estado.dialDisplayNumber = 'no ar'
  a.win.__redesenhou()
  check('não sobrescreve o que está no ar',
    espelhado(a) === 'no ar', espelhado(a))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
