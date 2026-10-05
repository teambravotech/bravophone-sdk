import { createWidget } from './widget.js'

// Sem default: o modo 'hosted' exige que o integrador diga qual é o host.
// Um default apontando para um domínio não publicado falha em DNS e o erro
// aparece longe da causa.
const DEFAULT_HOST = ''

let instance = null
const listeners = new Map()

function emit(event, payload) {
  listeners.get(event)?.forEach((fn) => {
    try { fn(payload) } catch (err) { console.error('[BCVoz] listener falhou:', err) }
  })
  listeners.get('*')?.forEach((fn) => {
    try { fn({ event, payload }) } catch (err) { console.error('[BCVoz] listener falhou:', err) }
  })
}

function requireInstance() {
  if (!instance) throw new Error('BCVoz: chame BCVoz.init() antes.')
  return instance
}

const BCVoz = {
  /**
   * Monta o webphone na página.
   * @param {object} opts
   * @param {string} [opts.hostUrl]  Origem do webphone hospedado.
   * @param {object} [opts.session]  Sessão do /api/voxfree/login — o objeto
   *   inteiro: { vxToken, expiresIn, sip, tenant, ramal, clienteId, ramaisUrl }.
   *   É o que o webphone precisa para registrar sem passar pela tela de login.
   * @param {string} [opts.token]    Atalho para `{ vxToken }`. Sozinho não
   *   basta: sem sip e ramal o webphone carrega mas não registra.
   * @param {'bottom-right'|'bottom-left'|'top-right'|'top-left'} [opts.position]
   * @param {boolean} [opts.open]     Abrir já visível (padrão: false, só o launcher).
   * @param {boolean} [opts.launcher] Exibir a aba de abertura (padrão: true).
   * @param {'hosted'|'srcdoc'} [opts.mode]
   *   'hosted' (padrão): o iframe navega para `hostUrl`. Uma origem fixa para
   *   o CORS dos backends, mas é um iframe de terceiro.
   *   'srcdoc': o iframe roda na origem do próprio site e busca o webphone no
   *   CDN. Some o iframe de terceiro — em troca, a origem do integrador
   *   precisa estar na allowlist de CORS dos backends.
   * @param {{hostname?: string, user?: string}} [opts.device] O que a página
   *   sabe da máquina, para o REGISTER identificar o aparelho na tela
   *   "Aparelhos" de uma ligação. Opcional; o que faltar não vai.
   * @param {() => Promise<object>} [opts.refreshSession]  Busca uma sessão
   *   nova no seu backend. Chamada antes do token vencer e quando a API
   *   devolve 401; sem ela o login cai quando o expiresIn acaba.
   */
  init(opts = {}) {
    if (instance) return instance
    if (typeof window === 'undefined' || !document.body) {
      throw new Error('BCVoz: init() precisa rodar no browser, após o <body> existir.')
    }
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      // getUserMedia só funciona em secure context — falhar cedo e claro
      // evita um bug reportado como "o microfone não funciona".
      console.warn('[BCVoz] Contexto inseguro: o microfone exige HTTPS ou localhost.')
    }
    // A versão vai junto: no modo srcdoc é ela que trava a URL dos assets no
    // CDN, garantindo que SDK e webphone nunca fiquem em versões diferentes.
    if (opts.mode === 'hosted' && !opts.hostUrl) {
      throw new Error(
        "BCVoz: mode 'hosted' exige hostUrl. Use mode 'srcdoc' (padrão) " +
        'para carregar o webphone do CDN sem depender de um host próprio.')
    }
    instance = createWidget({
      hostUrl: DEFAULT_HOST,
      version: BCVoz.version,
      ...opts,
      emit,
    })
    return instance
  },

  // ---- Controle da janela ----
  show()   { requireInstance().show() },
  hide()   { requireInstance().hide() },
  toggle() { requireInstance().toggle() },
  /** Abre a janela; se já estiver aberta, traz para a vista e destaca. */
  reveal() { requireInstance().reveal() },
  minimize(force) { requireInstance().minimize(force) },
  move(x, y)        { requireInstance().move(x, y) },
  resize(w, h)      { requireInstance().resize(w, h) },
  /** 'left' | 'right' | 'left-half' | 'right-half' | 'max' | 'float' */
  dock(zone)        { requireInstance().dock(zone) },
  /** Move a aba de abertura para o outro lado da viewport. */
  setLauncherSide(side) { requireInstance().setLauncherSide(side) },
  /** 'phone-waves' | 'waveform' | 'headset' | 'chat-phone' */
  setLauncherIcon(name) { requireInstance().setLauncherIcon(name) },
  get isOpen() { return instance ? instance.isOpen : false },
  get geometry() { return instance ? instance.geometry : null },

  // ---- Telefonia ----
  /** Disca um número. Aceita formato livre; a normalização é a mesma da extensão. */
  call(number, meta)  { return requireInstance().bridge.call('call', { number, meta }) },
  hangup()            { return requireInstance().bridge.call('hangup') },
  answer()            { return requireInstance().bridge.call('answer') },
  /** Alterna o mudo — o bundle só expõe toggle, não aceita estado alvo. */
  mute()              { return requireInstance().bridge.call('mute') },
  /** Alterna a espera. Também toggle. */
  hold()              { return requireInstance().bridge.call('hold') },
  sendDTMF(tone)      { return requireInstance().bridge.call('dtmf', { tone }) },
  transfer(to)        { return requireInstance().bridge.call('transfer', { to }) },
  getStatus()         { return requireInstance().bridge.call('status') },
  /** Escreve no campo sem discar — para o usuário conferir antes. */
  setDial(number)     { return requireInstance().bridge.call('setDial', { number }) },
  clearDial()         { return requireInstance().bridge.call('clearDial') },
  /** Troncos disponíveis e qual está em uso. */
  getRoutes()         { return requireInstance().bridge.call('routes') },
  /** Troca a provedora pela qual as próximas ligações saem. */
  setRoute(id)        { return requireInstance().bridge.call('setRoute', { id }) },
  /** Aceita a sessão completa do login, ou só o vxToken (insuficiente sozinho). */
  setAuth(sessao) {
    const session = typeof sessao === 'string' ? { vxToken: sessao } : sessao
    // Pelo widget, e não direto na ponte: ele recomeça a contagem do prazo.
    return requireInstance().setAuth(session)
  },
  logout()            { return requireInstance().bridge.call('logout') },
  /**
   * Conta ao webphone o que a página sabe da máquina (hostname, usuário).
   * Vai no REGISTER como X-Bravo-Device-*; se já registrado, reenvia.
   */
  setDevice(info)     { return requireInstance().bridge.call('device', info || {}) },

  // ---- Eventos ----
  /** Eventos: ready, state, call:dialing, call:incoming, call:answered,
   *  call:ended, call:blocked, resize, open, close, error, extension,
   *  session:renewed, session:expiring, session:expired. */
  on(event, fn) {
    if (!listeners.has(event)) listeners.set(event, new Set())
    listeners.get(event).add(fn)
    return () => BCVoz.off(event, fn)
  },
  off(event, fn) { listeners.get(event)?.delete(fn) },

  destroy() {
    instance?.destroy()
    instance = null
    listeners.clear()
  },

  // Substituída em build time pelo valor do package.json (ver vite.config.js).
  version: __BP_VERSION__,
}

// Uso via <script> puro: window.BCVoz.
if (typeof window !== 'undefined') {
  window.BCVoz = BCVoz
  // Nome anterior da marca. Integrações existentes chamam window.Bravophone;
  // o alias mantém todas funcionando e avisa uma vez para migrarem.
  if (!('Bravophone' in window)) {
    let avisou = false
    Object.defineProperty(window, 'Bravophone', {
      configurable: true,
      get() {
        if (!avisou) {
          avisou = true
          console.warn('[BCVoz] window.Bravophone foi descontinuado; use window.BCVoz.')
        }
        return BCVoz
      },
    })
  }
}

export default BCVoz
