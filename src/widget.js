import { WIDGET_CSS } from './styles.js'
import { makeDraggable, loadGeometry, clamp } from './draggable.js'
import { createBridge } from './bridge.js'
import { makeLauncher, loadLauncherState, clampY } from './launcher.js'
import { ICONS, DEFAULT_ICON, GRIP_ICON } from './icons.js'

const DEFAULTS = {
  // 380x640 é a geometria da janela nativa da extensão — o layout do
  // webphone é calibrado para ela, então é o ponto de partida aqui também.
  width: 380,
  height: 640,
  minWidth: 320,
  minHeight: 420,
  // Tetos generosos: o limite real é a viewport (ver limitsFor). O histórico
  // de chamadas fica ilegível espremido em 380px, então dá para alargar muito.
  maxWidth: 1600,
  maxHeight: 1400,
  margin: 24,
}

function h(tag, attrs = {}, children = []) {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v
    else if (k === 'text') el.textContent = v
    else if (v !== undefined && v !== null) el.setAttribute(k, v)
  }
  children.forEach((c) => el.appendChild(c))
  return el
}

export function createWidget(options) {
  const {
    hostUrl,
    token,
    position = 'bottom-right',
    open = false,
    launcher = true,
    title = 'BRAVOPHONE',
    // 'none' preserva 100% da UI do webphone: sem barra de titulo, o arraste
    // vem de dentro do iframe. 'bar' adiciona a barra com titulo e controles.
    frame = 'none',
    // O que arrastar até a borda de cima faz. 'max' é o gesto universal;
    // troque para 'top-half' se preferir as metades verticais no topo.
    dockTop = 'max',
    // Lado da viewport em que a aba de abertura fica colada.
    launcherSide = 'right',
    // Desenho da aba: 'phone-waves' | 'waveform' | 'headset' | 'chat-phone'
    launcherIcon = DEFAULT_ICON,
    emit,
  } = options

  const url = new URL(hostUrl)
  const origin = url.origin

  // O widget inteiro vive num Shadow DOM: o CSS da página do cliente não
  // alcança o widget, e o CSS do widget não alcança a página.
  const mount = h('div', { 'data-bravophone': 'root' })
  mount.style.cssText = 'all:initial;position:static'
  const shadow = mount.attachShadow({ mode: 'open' })
  shadow.appendChild(h('style', { text: WIDGET_CSS }))

  const geometryDefaults = (() => {
    const { width, height, margin } = DEFAULTS
    const right = window.innerWidth - width - margin
    const bottom = window.innerHeight - height - margin
    const map = {
      'bottom-right': { x: right, y: bottom },
      'bottom-left': { x: margin, y: bottom },
      'top-right': { x: right, y: margin },
      'top-left': { x: margin, y: margin },
    }
    return clamp({ ...(map[position] ?? map['bottom-right']), width, height })
  })()

  const geo = clamp(loadGeometry(geometryDefaults))

  const status = h('span', { class: 'bp-status', 'data-state': 'connecting' })
  const btnMin = h('button', { class: 'bp-btn bp-btn-min', title: 'Minimizar', text: '—' })
  const btnClose = h('button', { class: 'bp-btn bp-btn-close', title: 'Fechar', text: '×' })
  const header = h('div', { class: 'bp-header' }, [
    status,
    h('span', { class: 'bp-title', text: title }),
    btnMin,
    btnClose,
  ])

  // allow="microphone" é o que libera getUserMedia dentro do iframe cross-origin.
  // Sem isso o webphone carrega mas nunca consegue capturar áudio.
  const frameEl = h('iframe', {
    class: 'bp-frame',
    src: buildSrc(url, { token, embed: '1', parent: location.origin }),
    allow: 'microphone; autoplay; clipboard-write; speaker-selection',
    title: 'Webphone BRAVOPHONE',
  })

  // 8 alças: as laterais são o que resolve o histórico espremido.
  const DIRS = ['n', 's', 'w', 'e', 'nw', 'ne', 'sw', 'se']
  const handles = DIRS.map((d) => ({
    el: h('div', { class: `bp-h bp-h-${d}` }),
    dir: d,
  }))

  // Fantasma que mostra o encaixe antes de soltar.
  const preview = h('div', { class: 'bp-preview' })
  preview.hidden = true

  // Controles sobrepostos do modo sem moldura: aparecem no hover e flutuam
  // sobre o iframe, sem tirar um pixel da UI do webphone.
  // Só "fechar": minimizar esconderia .bp-body — e o overlay vive dentro dele,
  // deixando a janela sem como voltar. Recolher para o launcher já é o
  // equivalente a minimizar, e mantém um affordance visível.
  const ovClose = h('button', { class: 'bp-btn bp-btn-close', title: 'Fechar', text: '×' })
  const overlay = h('div', { class: 'bp-overlay' }, [ovClose])

  const body = h('div', { class: 'bp-body' }, [frameEl, overlay])
  const root = h('div', { class: 'bp-root' }, [header, body, ...handles.map((x) => x.el)])
  if (frame !== 'bar') root.classList.add('bp-chromeless')
  root.hidden = !open

  // Aba lateral de abertura: fica colada na borda, arrasta na vertical e
  // revela a alça de pontinhos no hover.
  const icon = h('span', { class: 'bp-launcher-icon' })
  icon.innerHTML = ICONS[launcherIcon] || ICONS[DEFAULT_ICON]
  const grip = h('span', { class: 'bp-launcher-grip', 'aria-hidden': 'true' })
  grip.innerHTML = GRIP_ICON
  const launcherBtn = h('div', {
    class: 'bp-launcher',
    role: 'button',
    tabindex: '0',
    title: 'Abrir webphone',
    'aria-label': 'Abrir webphone',
  }, [
    grip,
    icon,
    h('span', { class: 'bp-badge' }),
  ])
  launcherBtn.dataset.state = 'connecting'
  launcherBtn.hidden = !launcher || open

  shadow.append(preview, root, launcherBtn)
  document.body.appendChild(mount)

  const launcherState = loadLauncherState({
    side: launcherSide,
    y: Math.round(window.innerHeight / 2 - 24),
  })
  const launcherCtl = makeLauncher({
    el: launcherBtn,
    side: launcherState.side,
    y: clampY(launcherState.y, 48),
    onOpen: () => api.show(),
  })

  const drag = makeDraggable({
    root,
    handle: header,
    handles,
    preview,
    geometry: geo,
    limits: DEFAULTS,
    topDock: dockTop,
    onChange: (g) => emit('resize', { width: g.width, height: g.height, dock: g.dock || null }),
  })

  const bridge = createBridge({
    frame: frameEl,
    origin,
    onEvent: (name, payload) => {
      if (name === 'ready') {
        status.dataset.state = 'ready'
        launcherBtn.dataset.state = 'ready'
        if (token) bridge.call('auth', { token }).catch(() => {})
      }
      if (name === 'state') {
        const st = payload?.state ?? 'ready'
        status.dataset.state = st
        launcherBtn.dataset.state = st
      }
      if (name === 'call:incoming') {
        api.show()
        launcherBtn.dataset.badge = '1'
        launcherBtn.dataset.state = 'ringing'
      }
      if (name === 'call:answered') launcherBtn.dataset.state = 'incall'
      if (name === 'call:ended' || name === 'call:failed') {
        delete launcherBtn.dataset.badge
        launcherBtn.dataset.state = 'ready'
      }

      // Arraste originado dentro do iframe (modo sem moldura).
      if (name === 'drag:start') { drag.external.start(payload); return }
      if (name === 'drag:move')  { drag.external.move(payload); return }
      if (name === 'drag:end')   { drag.external.end(); return }

      emit(name, payload)
    },
  })

  let minimized = false

  const api = {
    el: mount,
    bridge,
    show() {
      root.hidden = false
      launcherBtn.hidden = true
      emit('open')
    },
    hide() {
      root.hidden = true
      if (launcher) launcherBtn.hidden = false
      emit('close')
    },
    toggle() { root.hidden ? api.show() : api.hide() },
    get isOpen() { return !root.hidden },
    minimize(force) {
      // Sem barra de título não há onde clicar para restaurar, então
      // minimizar recolhe para o launcher em vez de colapsar a janela.
      if (frame !== 'bar') { api.hide(); return }
      minimized = force ?? !minimized
      root.classList.toggle('bp-minimized', minimized)
      btnMin.textContent = minimized ? '▢' : '—'
    },
    move(x, y) { drag.set({ x, y }) },
    resize(width, height) { drag.set({ width, height }) },
    dock(zone) { drag.dock(zone) },
    setLauncherSide(side) { launcherCtl.setSide(side) },
    setLauncherIcon(name) { icon.innerHTML = ICONS[name] || ICONS[DEFAULT_ICON] },
    get geometry() { return drag.geometry },
    destroy() {
      bridge.destroy()
      drag.destroy()
      launcherCtl.destroy()
      preview.remove()
      mount.remove()
    },
  }

  btnClose.addEventListener('click', () => api.hide())
  btnMin.addEventListener('click', () => api.minimize())
  ovClose.addEventListener('click', () => api.hide())

  return api
}

function buildSrc(url, params) {
  const u = new URL(url.href)
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, v)
  }
  // O token viaja no hash, não na query: hash não vai em Referer nem em
  // logs de servidor/proxy.
  if (params.token) {
    u.searchParams.delete('token')
    u.hash = `token=${encodeURIComponent(params.token)}`
  }
  return u.href
}

export { DEFAULTS }
