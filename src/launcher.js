// Botão flutuante de abertura: uma aba colada na lateral da viewport,
// arrastável na vertical. No hover ela expande e revela a alça de pontinhos.

const STORAGE_KEY = 'bravophone:launcher'
/** Distância mínima percorrida para o gesto virar arraste em vez de clique. */
const DRAG_THRESHOLD = 4
const MARGIN = 8

export function loadLauncherState(fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback }
  } catch {
    return { ...fallback }
  }
}

function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch { /* sem persistência, mas o launcher segue funcionando */ }
}

/** Mantém a aba visível na vertical, qualquer que seja o tamanho da janela. */
export function clampY(y, height) {
  const max = Math.max(MARGIN, window.innerHeight - height - MARGIN)
  return Math.min(Math.max(MARGIN, y), max)
}

/**
 * @param {object} o
 * @param {HTMLElement} o.el      raiz da aba (já no DOM)
 * @param {'right'|'left'} o.side lado em que fica colada
 * @param {number} o.y            posição vertical inicial
 * @param {() => void} o.onOpen   chamado no clique (gesto sem arraste)
 */
export function makeLauncher({ el, side, y, onOpen }) {
  let state = { side, y: clampY(y, el.offsetHeight || 48) }
  let start = null
  let moved = false

  const apply = () => {
    el.dataset.side = state.side
    el.style.top = `${state.y}px`
    // O lado não usado precisa ser limpo, senão a aba fica presa nos dois.
    el.style.right = state.side === 'right' ? '0px' : 'auto'
    el.style.left = state.side === 'left' ? '0px' : 'auto'
  }

  const onDown = (ev) => {
    if (ev.button !== 0) return
    start = { py: ev.clientY, y: state.y }
    moved = false
    el.setPointerCapture(ev.pointerId)
    // Sem preventDefault aqui: ele mataria o clique quando não há arraste.
  }

  const onMove = (ev) => {
    if (!start) return
    const dy = ev.clientY - start.py
    if (!moved && Math.abs(dy) < DRAG_THRESHOLD) return
    if (!moved) {
      moved = true
      el.classList.add('bp-launcher-dragging')
    }
    state.y = clampY(start.y + dy, el.offsetHeight)
    apply()
  }

  const onUp = (ev) => {
    if (!start) return
    const wasDrag = moved
    start = null
    moved = false
    el.classList.remove('bp-launcher-dragging')
    try { el.releasePointerCapture(ev.pointerId) } catch {}
    if (wasDrag) save(state)
    // Um arraste não deve abrir o webphone; um clique parado, sim.
    else onOpen?.()
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)

  // Teclado: a aba é um botão, então Enter e Espaço precisam abrir.
  el.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') {
      ev.preventDefault()
      onOpen?.()
    }
  })

  const onResize = () => { state.y = clampY(state.y, el.offsetHeight); apply() }
  window.addEventListener('resize', onResize)

  apply()

  return {
    get state() { return { ...state } },
    setSide(next) { state.side = next; apply(); save(state) },
    moveTo(nextY) { state.y = clampY(nextY, el.offsetHeight); apply(); save(state) },
    destroy() { window.removeEventListener('resize', onResize) },
  }
}
