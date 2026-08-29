// Testes da aba lateral de abertura: arraste vertical, distinção entre
// arraste e clique, troca de lado e persistência.

globalThis.window = {
  innerWidth: 1280,
  innerHeight: 800,
  addEventListener: () => {},
  removeEventListener: () => {},
}
const store = new Map()
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const { makeLauncher, loadLauncherState, clampY } = await import('../src/launcher.js')

let pass = 0, fail = 0
const check = (name, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${extra !== undefined ? '  ' + JSON.stringify(extra) : ''}`) }
}

const HEIGHT = 48

function el() {
  const handlers = {}
  return {
    offsetHeight: HEIGHT,
    style: {},
    dataset: {},
    classList: {
      set: new Set(),
      add(c) { this.set.add(c) },
      remove(c) { this.set.delete(c) },
      contains(c) { return this.set.has(c) },
    },
    setPointerCapture() {}, releasePointerCapture() {},
    addEventListener(t, fn) { handlers[t] = fn },
    fire(t, ev) { handlers[t]?.({ button: 0, pointerId: 1, preventDefault() {}, ...ev }) },
  }
}

function build(opts = {}) {
  const node = el()
  let opened = 0
  const ctl = makeLauncher({
    el: node, side: 'right', y: 400,
    onOpen: () => { opened++ },
    ...opts,
  })
  return { node, ctl, opened: () => opened }
}

console.log('\nlauncher — clamp vertical:')
check('não sobe além da margem', clampY(-100, HEIGHT) === 8)
check('não desce além da base', clampY(9999, HEIGHT) === 800 - HEIGHT - 8, clampY(9999, HEIGHT))
check('valor no meio passa direto', clampY(300, HEIGHT) === 300)
{
  // Numa viewport menor que a aba, ainda assim fica visível.
  const orig = window.innerHeight
  window.innerHeight = 30
  check('viewport minúscula não gera posição negativa', clampY(500, HEIGHT) === 8)
  window.innerHeight = orig
}

console.log('\nlauncher — posicionamento:')
{
  const { node } = build()
  check('cola na direita', node.style.right === '0px' && node.style.left === 'auto', node.style)
  check('data-side reflete o lado', node.dataset.side === 'right')
  check('y inicial aplicado', node.style.top === '400px')
}
{
  const { node, ctl } = build()
  ctl.setSide('left')
  check('troca de lado limpa o lado oposto',
    node.style.left === '0px' && node.style.right === 'auto', node.style)
  check('data-side atualiza', node.dataset.side === 'left')
}

console.log('\nlauncher — arraste vs clique:')
{
  // Clique parado: abre.
  const { node, opened } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointerup', { clientY: 400 })
  check('clique sem mover abre o webphone', opened() === 1, opened())
}
{
  // Micro-movimento abaixo do limiar ainda conta como clique.
  const { node, opened, ctl } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointermove', { clientY: 402 })
  node.fire('pointerup', { clientY: 402 })
  check('tremida de 2px ainda abre', opened() === 1, opened())
  check('e não move a aba', ctl.state.y === 400, ctl.state)
}
{
  // Arraste de verdade: move e NÃO abre.
  const { node, opened, ctl } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointermove', { clientY: 300 })
  node.fire('pointerup', { clientY: 300 })
  check('arraste move a aba', ctl.state.y === 300, ctl.state)
  check('arraste NÃO abre o webphone', opened() === 0, opened())
}
{
  const { node, ctl } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointermove', { clientY: 5000 })
  node.fire('pointerup', { clientY: 5000 })
  check('arraste respeita o limite inferior', ctl.state.y === 744, ctl.state)
}
{
  const { node } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointermove', { clientY: 300 })
  check('marca a classe durante o arraste', node.classList.contains('bp-launcher-dragging'))
  node.fire('pointerup', { clientY: 300 })
  check('limpa a classe ao soltar', !node.classList.contains('bp-launcher-dragging'))
}
{
  // Botão secundário não deve iniciar nada.
  const { node, opened, ctl } = build()
  node.fire('pointerdown', { clientY: 400, button: 2 })
  node.fire('pointerup', { clientY: 400, button: 2 })
  check('botão direito é ignorado', opened() === 0 && ctl.state.y === 400)
}

console.log('\nlauncher — teclado:')
{
  const { node, opened } = build()
  node.fire('keydown', { key: 'Enter' })
  check('Enter abre', opened() === 1)
  node.fire('keydown', { key: ' ' })
  check('Espaço abre', opened() === 2)
  node.fire('keydown', { key: 'a' })
  check('outra tecla não abre', opened() === 2)
}

console.log('\nlauncher — persistência:')
{
  store.clear()
  const { node, ctl } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointermove', { clientY: 200 })
  node.fire('pointerup', { clientY: 200 })
  const restored = loadLauncherState({ side: 'right', y: 999 })
  check('posição do arraste persiste', restored.y === 200, restored)
  ctl.setSide('left')
  check('lado persiste', loadLauncherState({}).side === 'left')
}
{
  store.clear()
  const { node } = build()
  node.fire('pointerdown', { clientY: 400 })
  node.fire('pointerup', { clientY: 400 })
  check('clique puro não grava nada', store.size === 0, store.size)
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
