// Geometria da janela: arraste, redimensionamento pelas 8 bordas/cantos,
// e docking com prévia — encostar numa borda sugere um encaixe, soltar aplica.

const STORAGE_KEY = 'bravophone:widget:geometry'

/** Distância da borda da viewport que ativa a sugestão de dock. */
const DOCK_EDGE = 28
/** Folga em que o resize "gruda" numa borda da viewport. */
const RESIZE_SNAP = 32

export function loadGeometry(fallback) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { ...fallback }
    const saved = JSON.parse(raw)
    // Uma janela salva docada volta docada, mas recalculada para a viewport
    // atual — o tamanho de ontem não serve para a tela de hoje.
    if (saved.dock) return { ...fallback, ...saved, ...dockGeometry(saved.dock, saved) }
    return { ...fallback, ...saved }
  } catch {
    // localStorage pode lançar (modo privado, cookies bloqueados por política).
    return { ...fallback }
  }
}

function saveGeometry(geo) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(geo))
  } catch { /* sem persistência, mas o widget segue funcionando */ }
}

export function limitsFor(base) {
  return {
    minWidth: base.minWidth,
    minHeight: base.minHeight,
    // Teto relativo à viewport: numa tela larga o histórico de chamadas pode
    // usar o espaço que precisa, sem um limite fixo apertando.
    maxWidth: Math.max(base.minWidth, Math.min(base.maxWidth, window.innerWidth)),
    maxHeight: Math.max(base.minHeight, Math.min(base.maxHeight, window.innerHeight)),
  }
}

/** Mantém a janela dentro da viewport, deixando sempre a barra superior acessível. */
export function clamp(geo) {
  const maxX = Math.max(0, window.innerWidth - geo.width)
  const maxY = Math.max(0, window.innerHeight - 40)
  return {
    ...geo,
    x: Math.min(Math.max(0, geo.x), maxX),
    y: Math.min(Math.max(0, geo.y), maxY),
  }
}

/** Geometria final de cada zona de encaixe. */
export function dockGeometry(zone, geo) {
  const W = window.innerWidth
  const H = window.innerHeight
  const half = Math.round(W / 2)
  const mid = Math.round(H / 2)
  const w = Math.min(geo.width, W)
  switch (zone) {
    case 'left': return { x: 0, y: 0, width: w, height: H }
    case 'right': return { x: W - w, y: 0, width: w, height: H }
    case 'left-half': return { x: 0, y: 0, width: half, height: H }
    case 'right-half': return { x: W - half, y: 0, width: half, height: H }
    case 'top': return { x: geo.x, y: 0, width: w, height: mid }
    case 'bottom': return { x: geo.x, y: H - mid, width: w, height: mid }
    case 'top-half': return { x: 0, y: 0, width: W, height: mid }
    case 'bottom-half': return { x: 0, y: H - mid, width: W, height: mid }
    case 'max': return { x: 0, y: 0, width: W, height: H }
    default: return { x: geo.x, y: geo.y, width: geo.width, height: geo.height }
  }
}

/**
 * Zona sugerida a partir da posição do cursor na viewport — o perímetro inteiro
 * é mapeado, de forma simétrica nos dois eixos:
 *
 *     left-half │   topDock    │ right-half     ← cantos e borda de cima
 *     ──────────┼──────────────┼──────────
 *        left   │   (flutua)   │   right        ← laterais: altura cheia
 *     ──────────┼──────────────┼──────────
 *     left-half │ bottom-half  │ right-half     ← cantos e borda de baixo
 *
 * `topDock` é configurável porque o topo é disputado: 'max' é o gesto universal
 * (Windows, macOS), mas quem usa as metades verticais costuma preferir
 * 'top-half' ali, com o máximo ficando por API.
 */
function zoneFor(cx, cy, topDock) {
  const W = window.innerWidth
  const H = window.innerHeight
  const nearLeft = cx <= DOCK_EDGE
  const nearRight = cx >= W - DOCK_EDGE
  const nearTop = cy <= DOCK_EDGE
  const nearBottom = cy >= H - DOCK_EDGE

  if ((nearTop || nearBottom) && nearLeft) return 'left-half'
  if ((nearTop || nearBottom) && nearRight) return 'right-half'
  if (nearTop) return topDock || 'max'
  if (nearBottom) return 'bottom-half'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  return null
}

export function makeDraggable({ root, handle, handles, preview, geometry, limits: base, topDock, onChange }) {
  let geo = { ...geometry }
  let mode = null         // 'drag' | 'resize'
  let dir = ''            // combinação de n/s/e/w no resize
  let start = null
  let cursorOffset = null // onde o cursor pegou a janela
  let zone = null
  let restore = null      // geometria pré-dock, para voltar ao sair da borda

  const apply = () => {
    root.style.left = `${geo.x}px`
    root.style.top = `${geo.y}px`
    root.style.width = `${geo.width}px`
    root.style.height = `${geo.height}px`
    root.classList.toggle('bp-docked', !!geo.dock)
    onChange?.(geo)
  }

  const showPreview = (target) => {
    if (!preview) return
    if (!target) { preview.hidden = true; return }
    preview.hidden = false
    preview.style.left = `${target.x}px`
    preview.style.top = `${target.y}px`
    preview.style.width = `${target.width}px`
    preview.style.height = `${target.height}px`
  }

  // --- redimensionamento -----------------------------------------------------
  const resizeTo = (dx, dy) => {
    const lim = limitsFor(base)
    let { x, y, width, height } = start

    if (dir.includes('e')) width = start.width + dx
    if (dir.includes('w')) width = start.width - dx
    if (dir.includes('s')) height = start.height + dy
    if (dir.includes('n')) height = start.height - dy

    width = Math.min(lim.maxWidth, Math.max(lim.minWidth, width))
    height = Math.min(lim.maxHeight, Math.max(lim.minHeight, height))

    // Bordas norte/oeste movem a origem — mas só o quanto o tamanho realmente
    // mudou, senão a janela desliza depois de bater no mínimo.
    if (dir.includes('w')) x = start.x + (start.width - width)
    if (dir.includes('n')) y = start.y + (start.height - height)

    // "Completamento sugestivo": perto de uma borda da viewport, encaixa nela.
    if (dir.includes('e') && Math.abs(x + width - window.innerWidth) <= RESIZE_SNAP) {
      width = window.innerWidth - x
    }
    if (dir.includes('w') && Math.abs(x) <= RESIZE_SNAP) { width += x; x = 0 }
    if (dir.includes('s') && Math.abs(y + height - window.innerHeight) <= RESIZE_SNAP) {
      height = window.innerHeight - y
    }
    if (dir.includes('n') && Math.abs(y) <= RESIZE_SNAP) { height += y; y = 0 }

    geo = { ...geo, x, y, width, height, dock: null }
    apply()
  }

  // --- arraste ---------------------------------------------------------------
  const dragTo = (dx, dy, cursorX, cursorY) => {
    // Sair de uma janela docada devolve o tamanho flutuante anterior, com a
    // janela nascendo sob o cursor em vez de saltar para longe dele.
    if (geo.dock) {
      const prev = restore || { width: base.width, height: base.height }
      const ratio = cursorOffset.x / Math.max(1, geo.width)
      geo = { ...geo, ...prev, dock: null }
      cursorOffset = { x: Math.round(prev.width * ratio), y: Math.min(cursorOffset.y, 32) }
      start = {
        ...start,
        x: cursorX - cursorOffset.x,
        y: cursorY - cursorOffset.y,
        px: start.px + dx,
        py: start.py + dy,
      }
      dx = 0
      dy = 0
    }
    geo = clamp({ ...geo, x: start.x + dx, y: start.y + dy })
    apply()
    zone = zoneFor(cursorX, cursorY, topDock)
    showPreview(zone ? dockGeometry(zone, geo) : null)
  }

  const applyDock = () => {
    if (!zone) return
    restore = restore || { width: geo.width, height: geo.height }
    geo = { ...geo, ...dockGeometry(zone, geo), dock: zone }
    apply()
  }

  // --- gestos ---------------------------------------------------------------
  const begin = (kind, direction) => (ev) => {
    if (ev.button !== 0) return
    if (kind === 'drag' && ev.target.closest('.bp-btn')) return
    mode = kind
    dir = direction || ''
    start = { px: ev.clientX, py: ev.clientY, ...geo }
    cursorOffset = { x: ev.clientX - geo.x, y: ev.clientY - geo.y }
    if (!geo.dock) restore = { width: geo.width, height: geo.height }
    root.classList.add(kind === 'drag' ? 'bp-dragging' : 'bp-resizing')
    // setPointerCapture garante que continuamos recebendo os eventos mesmo
    // se o ponteiro sair da janela ou passar por cima de outro elemento.
    ev.currentTarget.setPointerCapture(ev.pointerId)
    ev.preventDefault()
  }

  const move = (ev) => {
    if (!mode || !start) return
    const dx = ev.clientX - start.px
    const dy = ev.clientY - start.py
    if (mode === 'drag') dragTo(dx, dy, ev.clientX, ev.clientY)
    else resizeTo(dx, dy)
  }

  const end = (ev) => {
    if (!mode) return
    root.classList.remove('bp-dragging', 'bp-resizing')
    showPreview(null)
    if (mode === 'drag') applyDock()
    mode = null
    dir = ''
    start = null
    zone = null
    try { ev.currentTarget.releasePointerCapture(ev.pointerId) } catch {}
    saveGeometry(geo)
  }

  handle.addEventListener('pointerdown', begin('drag'))
  handle.addEventListener('pointermove', move)
  handle.addEventListener('pointerup', end)
  handle.addEventListener('pointercancel', end)

  ;(handles || []).forEach(({ el, dir: d }) => {
    el.addEventListener('pointerdown', begin('resize', d))
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', end)
    el.addEventListener('pointercancel', end)
  })

  // Viewport mudou: janela docada reencaixa, flutuante volta para dentro.
  const onResize = () => {
    geo = geo.dock ? { ...geo, ...dockGeometry(geo.dock, geo) } : clamp(geo)
    apply()
  }
  window.addEventListener('resize', onResize)

  // Arraste comandado de fora — usado pelo modo sem moldura, em que a detecção
  // do gesto acontece dentro do iframe (cross-origin) e chega aqui como
  // coordenadas absolutas de tela.
  const external = {
    start(pt) {
      mode = 'drag'
      start = { px: pt.x, py: pt.y, ...geo }
      // cx/cy são a posição do cursor DENTRO do iframe; somada à posição da
      // janela dá a posição na viewport do host, que é o que o dock precisa.
      cursorOffset = { x: pt.cx ?? geo.width / 2, y: pt.cy ?? 20 }
      if (!geo.dock) restore = { width: geo.width, height: geo.height }
      root.classList.add('bp-dragging')
    },
    move(pt) {
      if (mode !== 'drag' || !start) return
      const dx = pt.x - start.px
      const dy = pt.y - start.py
      dragTo(dx, dy, start.x + dx + cursorOffset.x, start.y + dy + cursorOffset.y)
    },
    end() {
      if (mode !== 'drag') return
      root.classList.remove('bp-dragging')
      showPreview(null)
      applyDock()
      mode = null
      start = null
      zone = null
      saveGeometry(geo)
    },
  }

  apply()

  return {
    external,
    get geometry() { return { ...geo } },
    set(patch) {
      const lim = limitsFor(base)
      const next = { ...geo, ...patch, dock: null }
      next.width = Math.min(lim.maxWidth, Math.max(lim.minWidth, next.width))
      next.height = Math.min(lim.maxHeight, Math.max(lim.minHeight, next.height))
      geo = clamp(next)
      apply()
      saveGeometry(geo)
    },
    /** 'left' | 'right' | 'left-half' | 'right-half' | 'max' | 'float' */
    dock(target) {
      if (!target || target === 'float') {
        const prev = restore || { width: base.width, height: base.height }
        geo = clamp({ ...geo, ...prev, dock: null })
      } else {
        if (!geo.dock) restore = { width: geo.width, height: geo.height }
        geo = { ...geo, ...dockGeometry(target, geo), dock: target }
      }
      apply()
      saveGeometry(geo)
    },
    destroy() { window.removeEventListener('resize', onResize) },
  }
}
