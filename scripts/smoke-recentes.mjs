// O painel de Recentes abre por um botão, e o tamanho da janela fica travado.
//
// POR QUE EXISTE: o bundle desenha a coluna do discador com 380px fixos e põe
// os Recentes no espaço que sobrar ao lado. Com a janela redimensionável, o
// painel aparecia e sumia conforme a largura que a pessoa arrastava — e o
// tamanho ficava ao acaso. Agora a janela tem dois tamanhos (380 e 660), e
// quem escolhe é o botão. Este arquivo monta o widget de verdade num DOM
// mínimo falso, sem dependências.

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + JSON.stringify(extra) : ''}`) }
}

// --- DOM mínimo ---------------------------------------------------------------
function elemento(tag) {
  const lis = {}
  const classes = new Set()
  const attrs = {}
  const el = {
    tagName: tag.toUpperCase(),
    children: [],
    parent: null,
    sombra: null,
    hidden: false,
    textContent: '',
    innerHTML: '',
    title: '',
    style: {},
    dataset: {},
    offsetWidth: 48,
    offsetHeight: 48,
    contentWindow: null,
    get className() { return [...classes].join(' ') },
    set className(v) { classes.clear(); String(v).split(/\s+/).filter(Boolean).forEach((c) => classes.add(c)) },
    classList: {
      add: (...c) => c.forEach((x) => classes.add(x)),
      remove: (...c) => c.forEach((x) => classes.delete(x)),
      contains: (c) => classes.has(c),
      toggle: (c, on) => { const v = on === undefined ? !classes.has(c) : !!on; v ? classes.add(c) : classes.delete(c); return v },
    },
    setAttribute: (k, v) => { attrs[k] = String(v) },
    getAttribute: (k) => (k in attrs ? attrs[k] : null),
    removeAttribute: (k) => { delete attrs[k] },
    appendChild(c) { c.parent = el; el.children.push(c); return c },
    append(...cs) { cs.forEach((c) => el.appendChild(c)) },
    remove() { if (el.parent) el.parent.children = el.parent.children.filter((x) => x !== el) },
    attachShadow() { el.sombra = elemento('#shadow'); return el.sombra },
    addEventListener(t, fn) { (lis[t] = lis[t] || []).push(fn) },
    removeEventListener(t, fn) { lis[t] = (lis[t] || []).filter((x) => x !== fn) },
    setPointerCapture() {},
    releasePointerCapture() {},
    closest(sel) {
      const c = sel.replace(/^\./, '')
      for (let n = el; n; n = n.parent) if (n.classList && n.classList.contains(c)) return n
      return null
    },
    disparar(t, ev = {}) {
      (lis[t] || []).forEach((fn) => fn({
        target: el, currentTarget: el, button: 0, pointerId: 1, preventDefault() {}, ...ev,
      }))
    },
  }
  return el
}

function ambiente({ largura = 1280, altura = 800, salvo = {} } = {}) {
  const store = new Map(Object.entries(salvo))
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  globalThis.document = { createElement: elemento, body: elemento('body') }
  globalThis.window = globalThis
  globalThis.innerWidth = largura
  globalThis.innerHeight = altura
  globalThis.location = { origin: 'https://cliente.exemplo', protocol: 'https:', hostname: 'cliente.exemplo' }
  globalThis.matchMedia = () => ({ matches: false })
  globalThis.addEventListener = () => {}
  globalThis.removeEventListener = () => {}
  return store
}

const { createWidget } = await import('../src/widget.js')

function montar(opts = {}, amb = {}) {
  const store = ambiente(amb)
  const eventos = []
  const w = createWidget({ version: '0.0.0', open: true, emit: (n, p) => eventos.push({ n, p }), ...opts })
  const sombra = w.el.sombra
  const achar = (classe) => {
    const out = []
    const andar = (n) => n.children.forEach((c) => { if (c.classList.contains(classe)) out.push(c); andar(c) })
    andar(sombra)
    return out
  }
  return { w, store, eventos, achar }
}

/** Arrasta a barra de título até (x, y) e solta. */
function arrastarBarra(t, x, y) {
  const g = t.w.geometry
  const [barra] = t.achar('bp-header')
  barra.disparar('pointerdown', { clientX: g.x + 100, clientY: g.y + 10 })
  barra.disparar('pointermove', { clientX: x, clientY: y })
  barra.disparar('pointerup', { clientX: x, clientY: y })
}

const bordaDireita = (g) => g.x + g.width

// ------------------------------------------------------------------------------
console.log('\ntamanho — travado por padrão:')
{
  const t = montar()
  const g = t.w.geometry
  check('nasce com 380 de largura', g.width === 380, g)
  check('e 640 de altura', g.height === 640, g)
  check('não nasce docada', !g.dock)
  check('nenhuma alça de redimensionar', t.achar('bp-h').length === 0, t.achar('bp-h').length)
}

console.log('\ntamanho — arrastar até a borda move, mas não encaixa:')
{
  const t = montar()
  arrastarBarra(t, 5, 300)
  const g = t.w.geometry
  check('não docou', !g.dock, g)
  check('continua 380x640', g.width === 380 && g.height === 640, g)
  check('mas a janela andou', g.x === 0, g)
}

console.log('\ntamanho — o que estava salvo de antes não destrava:')
{
  const salvo = { 'bravophone:widget:geometry': JSON.stringify({ x: 50, y: 40, width: 900, height: 700, dock: 'max' }) }
  const t = montar({}, { salvo })
  const g = t.w.geometry
  check('largura volta para 380', g.width === 380, g)
  check('altura volta para 640', g.height === 640, g)
  check('o encaixe salvo é ignorado', !g.dock, g)
  check('docada, volta para o canto padrão (e não para 0,0)',
    g.x === 1280 - 380 - 24 && g.y === 800 - 640 - 24, g)
}
{
  const salvo = { 'bravophone:widget:geometry': JSON.stringify({ x: 50, y: 40, width: 900, height: 700 }) }
  const g = montar({}, { salvo }).w.geometry
  check('flutuante, a posição salva é mantida', g.x === 50 && g.y === 40 && g.width === 380, g)
}

console.log('\nrecentes — o botão abre e fecha o painel:')
{
  const t = montar()
  const [botao] = t.achar('bp-btn-recentes')
  check('o botão está na barra', !!botao && botao.parent.classList.contains('bp-header'))
  check('começa fechado', t.w.recentsOpen === false && botao.getAttribute('aria-pressed') === 'false')
  check('com rótulo para leitor de tela', botao.getAttribute('aria-label') === 'Mostrar recentes')

  const g0 = t.w.geometry
  botao.disparar('click')
  const g1 = t.w.geometry
  check('clicar alarga para 660', g1.width === 660, g1)
  check('a borda direita fica no lugar', bordaDireita(g1) === bordaDireita(g0), [g0, g1])
  check('a altura não muda', g1.height === 640, g1)
  check('o botão mostra que está aberto',
    botao.getAttribute('aria-pressed') === 'true' && botao.getAttribute('aria-label') === 'Ocultar recentes')
  check('avisa o integrador', t.eventos.some((e) => e.n === 'recents' && e.p.open === true))
  check('lembra a escolha', t.store.get('bravophone:widget:recentes') === '1')

  botao.disparar('click')
  const g2 = t.w.geometry
  check('clicar de novo volta para 380', g2.width === 380, g2)
  check('e a borda direita continua no lugar', bordaDireita(g2) === bordaDireita(g0), [g0, g2])
  check('lembra que fechou', t.store.get('bravophone:widget:recentes') === '0')

  t.w.toggleRecents(false)
  check('toggleRecents(false) com ele fechado não mexe', t.w.geometry.width === 380)
  t.w.toggleRecents(true)
  check('toggleRecents(true) abre', t.w.geometry.width === 660 && t.w.recentsOpen === true)
}

console.log('\nrecentes — aberto, o tamanho continua travado:')
{
  const t = montar()
  t.w.toggleRecents(true)
  arrastarBarra(t, 5, 300)
  const g = t.w.geometry
  check('arrastar até a borda não docou', !g.dock && g.width === 660, g)
}

console.log('\nrecentes — a escolha volta na próxima visita:')
{
  const t = montar({}, { salvo: { 'bravophone:widget:recentes': '1' } })
  check('nasce com o painel aberto', t.w.geometry.width === 660 && t.w.recentsOpen === true, t.w.geometry)
}

console.log('\nrecentes — viewport estreita:')
{
  const t = montar({}, { largura: 500 })
  t.w.toggleRecents(true)
  const g = t.w.geometry
  check('não passa da largura da tela', g.width <= 500, g)
  check('e não sai da tela', g.x >= 0 && g.x + g.width <= 500, g)
}

console.log('\nrecentes — modo sem moldura também tem o botão:')
{
  const t = montar({ frame: 'none' })
  const botoes = t.achar('bp-btn-recentes')
  check('um deles no overlay', botoes.some((b) => b.parent.classList.contains('bp-overlay')))
}

console.log('\nrecentes — recents:false some com o botão:')
{
  const t = montar({ recents: false }, { salvo: { 'bravophone:widget:recentes': '1' } })
  const visiveis = t.achar('bp-btn-recentes')
  check('nenhum botão na tela', visiveis.length === 0, visiveis.length)
  check('ignora a escolha salva', t.w.recentsOpen === false && t.w.geometry.width === 380, t.w.geometry)
}

console.log('\nresizable:true — o comportamento antigo continua disponível:')
{
  const salvo = { 'bravophone:widget:geometry': JSON.stringify({ x: 50, y: 40, width: 900, height: 700 }) }
  const t = montar({ resizable: true }, { salvo })
  const g = t.w.geometry
  check('respeita o tamanho salvo', g.width === 900 && g.height === 700, g)
  check('as 8 alças voltam', t.achar('bp-h').length === 8, t.achar('bp-h').length)
  arrastarBarra(t, 5, 300)
  check('e arrastar até a borda encaixa', t.w.geometry.dock === 'left', t.w.geometry)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
