// Testes da geometria da janela (dock, clamp, resize pelas 8 bordas) num DOM
// mínimo simulado. Sem browser, sem dependências.

const VIEWPORT = { w: 1280, h: 800 }

const listeners = {}
globalThis.window = {
  innerWidth: VIEWPORT.w,
  innerHeight: VIEWPORT.h,
  addEventListener: (t, fn) => { (listeners[t] = listeners[t] || []).push(fn) },
  removeEventListener: () => {},
}
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { makeDraggable, dockGeometry, clamp, limitsFor, loadGeometry } =
  await import('../src/draggable.js')

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? '  ' + JSON.stringify(extra) : ''}`) }
}

/** Elemento falso: só o que o módulo toca. */
function el() {
  const handlers = {}
  return {
    style: {},
    hidden: false,
    classList: {
      set: new Set(),
      add(...c) { c.forEach((x) => this.set.add(x)) },
      remove(...c) { c.forEach((x) => this.set.delete(x)) },
      toggle(c, on) { on ? this.set.add(c) : this.set.delete(c) },
      contains(c) { return this.set.has(c) },
    },
    addEventListener(t, fn) { handlers[t] = fn },
    fire(t, ev) { handlers[t]?.({ button: 0, preventDefault() {}, currentTarget: { setPointerCapture() {}, releasePointerCapture() {} }, closest: () => null, target: { closest: () => null }, ...ev }) },
  }
}

const BASE = {
  width: 380, height: 640,
  minWidth: 320, minHeight: 420,
  maxWidth: 1600, maxHeight: 1400,
}

function build(geoOverride = {}, topDock) {
  const root = el()
  const handle = el()
  const preview = el()
  const dirs = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']
  const handles = dirs.map((d) => ({ el: el(), dir: d }))
  const api = makeDraggable({
    root, handle, handles, preview, topDock,
    geometry: { x: 400, y: 200, width: 380, height: 640, ...geoOverride },
    limits: BASE,
    onChange: () => {},
  })
  const byDir = Object.fromEntries(handles.map((x) => [x.dir, x.el]))
  return { api, root, handle, preview, byDir }
}

/** Simula um gesto completo: pointerdown, move, up. */
function gesture(target, from, to) {
  target.fire('pointerdown', { clientX: from.x, clientY: from.y, pointerId: 1 })
  target.fire('pointermove', { clientX: to.x, clientY: to.y, pointerId: 1 })
  target.fire('pointerup', { clientX: to.x, clientY: to.y, pointerId: 1 })
}

console.log('\ngeometria — dockGeometry:')
{
  const g = { x: 100, y: 100, width: 400, height: 600 }
  check('max ocupa a viewport',
    JSON.stringify(dockGeometry('max', g)) === JSON.stringify({ x: 0, y: 0, width: 1280, height: 800 }))
  check('right cola na direita com altura cheia',
    JSON.stringify(dockGeometry('right', g)) === JSON.stringify({ x: 880, y: 0, width: 400, height: 800 }))
  check('left cola na esquerda',
    JSON.stringify(dockGeometry('left', g)) === JSON.stringify({ x: 0, y: 0, width: 400, height: 800 }))
  check('right-half usa metade da largura',
    dockGeometry('right-half', g).width === 640 && dockGeometry('right-half', g).x === 640)
  check('largura maior que a viewport é limitada',
    dockGeometry('right', { ...g, width: 5000 }).width === 1280)
}

console.log('\ngeometria — clamp e limites:')
{
  check('clamp prende à esquerda', clamp({ x: -50, y: 10, width: 380, height: 640 }).x === 0)
  check('clamp prende à direita', clamp({ x: 9999, y: 10, width: 380, height: 640 }).x === 900)
  check('clamp deixa o topo sempre alcançável',
    clamp({ x: 10, y: 9999, width: 380, height: 640 }).y === 760)
  const lim = limitsFor(BASE)
  check('maxWidth limitado pela viewport', lim.maxWidth === 1280)
  check('maxHeight limitado pela viewport', lim.maxHeight === 800)
}

console.log('\ngeometria — resize pelas bordas:')
{
  const { api, byDir } = build()
  gesture(byDir.e, { x: 780, y: 500 }, { x: 1000, y: 500 })
  check('borda leste alarga', api.geometry.width === 600, api.geometry)
  check('borda leste não move x', api.geometry.x === 400, api.geometry)
}
{
  const { api, byDir } = build()
  // Oeste: alarga para a esquerda, movendo a origem.
  gesture(byDir.w, { x: 400, y: 500 }, { x: 300, y: 500 })
  check('borda oeste alarga', api.geometry.width === 480, api.geometry)
  check('borda oeste move a origem', api.geometry.x === 300, api.geometry)
}
{
  const { api, byDir } = build()
  // Encolhe além do mínimo: largura trava em 320 e x não pode continuar andando.
  gesture(byDir.w, { x: 400, y: 500 }, { x: 900, y: 500 })
  check('oeste respeita minWidth', api.geometry.width === 320, api.geometry)
  check('oeste não desliza após o mínimo', api.geometry.x === 460, api.geometry)
}
{
  const { api, byDir } = build()
  gesture(byDir.n, { x: 500, y: 200 }, { x: 500, y: 100 })
  check('borda norte cresce para cima', api.geometry.height === 740, api.geometry)
  check('borda norte move y', api.geometry.y === 100, api.geometry)
}
{
  const { api, byDir } = build()
  gesture(byDir.se, { x: 780, y: 840 }, { x: 900, y: 900 })
  check('canto SE muda os dois eixos',
    api.geometry.width === 500 && api.geometry.height === 700, api.geometry)
}

console.log('\ngeometria — snap sugestivo no resize:')
{
  const { api, byDir } = build({ x: 400, y: 200 })
  // Solta a 20px da borda direita (dentro dos 32 de folga): deve completar.
  gesture(byDir.e, { x: 780, y: 500 }, { x: 1260, y: 500 })
  check('leste completa até a borda da viewport',
    api.geometry.x + api.geometry.width === 1280, api.geometry)
}
{
  const { api, byDir } = build({ x: 20, y: 200 })
  gesture(byDir.w, { x: 20, y: 500 }, { x: 10, y: 500 })
  check('oeste completa até x=0', api.geometry.x === 0, api.geometry)
}
{
  const { api, byDir } = build({ x: 400, y: 100, height: 660 })
  gesture(byDir.s, { x: 500, y: 760 }, { x: 500, y: 780 })
  check('sul completa até a base',
    api.geometry.y + api.geometry.height === 800, api.geometry)
}

console.log('\ngeometria — docking por arraste:')
{
  const { api, handle, preview } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 1275, clientY: 400, pointerId: 1 })
  check('prévia aparece na borda direita', preview.hidden === false)
  check('prévia mostra altura cheia', preview.style.height === '800px', preview.style)
  handle.fire('pointerup', { clientX: 1275, clientY: 400, pointerId: 1 })
  check('soltou: encaixou à direita', api.geometry.dock === 'right', api.geometry)
  check('encaixe usa altura cheia', api.geometry.height === 800, api.geometry)
  check('prévia some ao soltar', preview.hidden === true)
}
{
  const { api, handle, preview } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 600, clientY: 5, pointerId: 1 })
  handle.fire('pointerup', { clientX: 600, clientY: 5, pointerId: 1 })
  check('topo maximiza',
    api.geometry.dock === 'max' && api.geometry.width === 1280, api.geometry)
}
{
  const { api, handle } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 4, clientY: 4, pointerId: 1 })
  handle.fire('pointerup', { clientX: 4, clientY: 4, pointerId: 1 })
  check('canto superior esquerdo dá meia tela',
    api.geometry.dock === 'left-half' && api.geometry.width === 640, api.geometry)
}
{
  const { api, handle } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 700, clientY: 400, pointerId: 1 })
  handle.fire('pointerup', { clientX: 700, clientY: 400, pointerId: 1 })
  check('meio da tela não encaixa', !api.geometry.dock, api.geometry)
}

console.log('\ngeometria — sair do dock restaura o tamanho:')
{
  const { api, handle } = build()
  api.dock('right')
  check('dock() aplica', api.geometry.dock === 'right' && api.geometry.height === 800)
  api.dock('float')
  check('float restaura a largura anterior', api.geometry.width === 380, api.geometry)
  check('float restaura a altura anterior', api.geometry.height === 640, api.geometry)
  check('float limpa o dock', !api.geometry.dock)
}
{
  const { api, handle } = build()
  api.dock('max')
  // Arrastar para o meio deve soltar o encaixe e devolver o tamanho flutuante.
  handle.fire('pointerdown', { clientX: 600, clientY: 20, pointerId: 1 })
  handle.fire('pointermove', { clientX: 620, clientY: 300, pointerId: 1 })
  handle.fire('pointerup', { clientX: 620, clientY: 300, pointerId: 1 })
  check('arrastar para fora desencaixa', !api.geometry.dock, api.geometry)
  check('e devolve o tamanho flutuante', api.geometry.width === 380, api.geometry)
}

console.log('\ngeometria - metades verticais:')
{
  const g = { x: 100, y: 100, width: 400, height: 600 }
  const bh = dockGeometry('bottom-half', g)
  check('bottom-half ocupa a metade de baixo, largura cheia',
    bh.x === 0 && bh.y === 400 && bh.width === 1280 && bh.height === 400, bh)
  const th = dockGeometry('top-half', g)
  check('top-half ocupa a metade de cima, largura cheia',
    th.x === 0 && th.y === 0 && th.width === 1280 && th.height === 400, th)
  check('top-half + bottom-half cobrem a tela sem sobrepor',
    th.height + bh.height === 800 && th.height === bh.y, { th, bh })
  const b = dockGeometry('bottom', g)
  check('bottom mantem a largura atual',
    b.width === 400 && b.x === 100 && b.y === 400 && b.height === 400, b)
}
{
  const { api, handle, preview } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 600, clientY: 795, pointerId: 1 })
  check('previa aparece na borda de baixo', preview.hidden === false)
  check('previa mostra a metade inferior',
    preview.style.top === '400px' && preview.style.height === '400px', preview.style)
  handle.fire('pointerup', { clientX: 600, clientY: 795, pointerId: 1 })
  check('borda de baixo encaixa em bottom-half',
    api.geometry.dock === 'bottom-half' && api.geometry.height === 400, api.geometry)
}
{
  const { api, handle } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 5, clientY: 795, pointerId: 1 })
  handle.fire('pointerup', { clientX: 5, clientY: 795, pointerId: 1 })
  check('canto inferior esquerdo da meia tela',
    api.geometry.dock === 'left-half' && api.geometry.width === 640, api.geometry)
}
{
  const { api, handle } = build()
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 1275, clientY: 795, pointerId: 1 })
  handle.fire('pointerup', { clientX: 1275, clientY: 795, pointerId: 1 })
  check('canto inferior direito da meia tela direita',
    api.geometry.dock === 'right-half' && api.geometry.x === 640, api.geometry)
}
{
  const { api, handle } = build({}, 'top-half')
  handle.fire('pointerdown', { clientX: 500, clientY: 210, pointerId: 1 })
  handle.fire('pointermove', { clientX: 600, clientY: 5, pointerId: 1 })
  handle.fire('pointerup', { clientX: 600, clientY: 5, pointerId: 1 })
  check('dockTop:top-half muda o gesto do topo',
    api.geometry.dock === 'top-half' && api.geometry.height === 400, api.geometry)
}
{
  const { api } = build()
  api.dock('bottom-half')
  check('dock("bottom-half") por API', api.geometry.dock === 'bottom-half')
  api.dock('float')
  check('float volta do bottom-half',
    !api.geometry.dock && api.geometry.height === 640, api.geometry)
}

console.log('\ngeometria — persistência:')
{
  store.clear()
  const { api } = build()
  api.dock('right')
  const restored = loadGeometry(BASE)
  check('dock persiste', restored.dock === 'right', restored)
  check('dock é recalculado para a viewport atual',
    restored.height === 800 && restored.x + restored.width === 1280, restored)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
