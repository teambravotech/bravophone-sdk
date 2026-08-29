/*!
 * guest-bridge.js — lado iframe do canal postMessage.
 *
 * Carrega DEPOIS de popup.js. Faz duas coisas:
 *   1. traduz comandos vindos do site (call, hangup, mute...) em ações no
 *      webphone, usando os mesmos pontos de entrada que a extensão usa;
 *   2. publica eventos de telefonia de volta para o site.
 *
 * Para discar usamos a mesma porta que os content-scripts de CRM usam no
 * click-to-call: chrome.runtime.onMessage com method 'webphoneDialNow'. Ela
 * desemboca em 'webphone-dial-from-pad', o funil único de ligações — então
 * normalização de número, seleção de rota e registro de origem continuam
 * valendo exatamente como na extensão.
 */
;(function () {
  'use strict'

  var PROTOCOL = 'bravophone/v1'
  var parentOrigin = null

  // A origem do pai chega por query string e é validada contra a allowlist
  // do servidor (ver host/allowed-origins.json). Nunca confiar só nisto.
  try {
    var params = new URLSearchParams(location.search)
    parentOrigin = params.get('parent')
  } catch (_) {}

  if (!parentOrigin || window.parent === window) {
    console.warn('[bp-bridge] sem origem pai; rodando standalone.')
    return
  }

  function post(msg) {
    try {
      window.parent.postMessage(Object.assign({ protocol: PROTOCOL }, msg), parentOrigin)
    } catch (err) {
      console.error('[bp-bridge] postMessage falhou:', err)
    }
  }

  var bridge = {
    emit: function (name, payload) { post({ type: 'event', name: name, payload: payload }) },
  }
  window.__bpBridge = bridge

  // --- espera o app Vue montar e expor os handles ---
  function waitFor(getter, timeout) {
    return new Promise(function (resolve, reject) {
      var started = Date.now()
      ;(function tick() {
        var v
        try { v = getter() } catch (_) {}
        if (v) return resolve(v)
        if (Date.now() - started > (timeout || 20000)) {
          return reject(new Error('Bravophone: webphone não inicializou a tempo'))
        }
        setTimeout(tick, 120)
      })()
    })
  }

  // --- como se fala com o bundle -------------------------------------------
  //
  // O popup.js NÃO expõe nada em window. Há dois caminhos de verdade, ambos
  // levantados do próprio bundle:
  //
  //  1. DISCAR — chrome.runtime.onMessage com method 'webphoneDialNow'. É a
  //     mesma porta que os content-scripts de CRM usam para click-to-call, e
  //     por dentro ela emite 'webphone-dial-from-pad', o funil único de
  //     ligações: normalização de número, seleção de rota e registro de
  //     origem continuam valendo iguais aos da extensão.
  //
  //  2. AÇÕES EM CHAMADA — o emitter (mitt) que o app publica via
  //     `app.provide(...)`: call-answer, call-hangup, call-toggle-mute,
  //     call-toggle-hold.
  //
  // O emitter é achado pela FORMA (um objeto com on/off/emit), não pelo nome
  // da chave — o bundle é minificado e a chave muda a cada build.

  function vueApp() {
    var root = document.getElementById('app')
    return (root && root.__vue_app__) || null
  }

  function findEmitter() {
    var app = vueApp()
    if (!app) return null
    var pools = []
    if (app._context) {
      if (app._context.provides) pools.push(app._context.provides)
      if (app._context.config && app._context.config.globalProperties) {
        pools.push(app._context.config.globalProperties)
      }
    }
    if (app.config && app.config.globalProperties) pools.push(app.config.globalProperties)

    for (var i = 0; i < pools.length; i++) {
      var pool = pools[i]
      for (var k in pool) {
        var v = pool[k]
        // Assinatura do mitt: { all, on, off, emit }
        if (v && typeof v.emit === 'function' && typeof v.on === 'function' &&
            typeof v.off === 'function') return v
      }
    }
    return null
  }

  function findStore() {
    var app = vueApp()
    if (!app) return null
    var pools = []
    if (app._context && app._context.provides) pools.push(app._context.provides)
    if (app.config && app.config.globalProperties) pools.push(app.config.globalProperties)
    for (var i = 0; i < pools.length; i++) {
      for (var k in pools[i]) {
        var v = pools[i][k]
        if (v && v.state && typeof v.commit === 'function') return v
      }
    }
    return null
  }

  /** Emite no emitter do app; falha com mensagem clara se ele não aparecer. */
  function emitApp(event, arg) {
    return waitFor(findEmitter, 20000).then(function (em) {
      em.emit(event, arg)
      return { ok: true }
    })
  }

  // --- comandos aceitos do site hospedeiro ---
  var commands = {
    auth: function (p) {
      // Sessão do integrador: grava onde o bundle já procura o token.
      if (!p || !p.token) throw new Error('token ausente')
      return new Promise(function (resolve) {
        chrome.storage.local.set({ vxToken: p.token }, function () {
          chrome.storage.sync.set({ vxToken: p.token }, function () { resolve({ ok: true }) })
        })
      })
    },

    logout: function () {
      return new Promise(function (resolve) {
        chrome.storage.local.remove(['vxToken'], function () {
          chrome.storage.sync.remove(['vxToken'], function () { resolve({ ok: true }) })
        })
      })
    },

    call: function (p) {
      if (!p || !p.number) throw new Error('número ausente')
      var meta = p.meta || {}
      // Mesmo payload que a API pública da extensão monta para os CRMs.
      var payload = {
        phone: String(p.number),
        name: meta.name || null,
        crm: meta.crm || null,
        photo: meta.photo || null,
        gateway: meta.gateway || meta.source || 'sdk',
        dealId: meta.dealId || null,
        pipedriveUrl: meta.url || null,
      }

      return new Promise(function (resolve, reject) {
        var answered = false
        // O listener do popup só existe depois do app montar; se ainda não
        // houver ninguém escutando, esperamos e reenviamos.
        var attempts = 0
        ;(function send() {
          attempts++
          if (!chrome.runtime.onMessage.hasListeners() && attempts < 60) {
            return setTimeout(send, 200)
          }
          if (!chrome.runtime.onMessage.hasListeners()) {
            return reject(new Error('webphone não terminou de carregar'))
          }
          chrome.runtime.sendMessage({ method: 'webphoneDialNow', payload: payload }, function () {
            if (answered) return
            answered = true
            resolve({ ok: true, phone: payload.phone })
          })
          // sendMessage responde de forma síncrona no shim; este timeout só
          // cobre o caso de nenhum listener responder.
          setTimeout(function () {
            if (!answered) { answered = true; resolve({ ok: true, phone: payload.phone }) }
          }, 300)
        })()
      })
    },

    hangup: function () { return emitApp('call-hangup') },
    answer: function () { return emitApp('call-answer') },
    // mute/hold do bundle são TOGGLE: não aceitam estado alvo.
    mute: function () { return emitApp('call-toggle-mute') },
    hold: function () { return emitApp('call-toggle-hold') },
    dtmf: function (p) {
      if (!p || p.tone == null) throw new Error('tom ausente')
      return emitApp('webphone-dial-key', String(p.tone))
    },
    transfer: function (p) {
      if (!p || !p.to) throw new Error('destino ausente')
      return emitApp('webphone-transfer-initiated', String(p.to))
    },
    clearDial: function () { return emitApp('webphone-dial-clear') },

    status: function () {
      var store = findStore()
      var st = (store && store.state) || {}
      return Promise.resolve({
        ready: !!findEmitter(),
        inCall: !!(st.callActive || st.callPhase),
        phase: st.callPhase || null,
        number: st.callDisplay || null,
        incoming: !!st.callIsIncoming,
        muted: !!st.callMuted,
        held: !!st.callHeld,
      })
    },

    ping: function () { return Promise.resolve({ pong: Date.now() }) },
  }

  function ok() { return { ok: true } }

  window.addEventListener('message', function (ev) {
    if (ev.origin !== parentOrigin) return
    if (ev.source !== window.parent) return
    var msg = ev.data
    if (!msg || msg.protocol !== PROTOCOL || msg.type !== 'command') return

    var fn = commands[msg.command]
    if (!fn) {
      post({ type: 'reply', id: msg.id, error: 'comando desconhecido: ' + msg.command })
      return
    }
    Promise.resolve()
      .then(function () { return fn(msg.payload || {}) })
      .then(function (payload) { post({ type: 'reply', id: msg.id, payload: payload }) })
      .catch(function (err) { post({ type: 'reply', id: msg.id, error: String(err && err.message || err) }) })
  })

  // --- eventos de telefonia -> site ----------------------------------------
  //
  // Não há um `libwebphone` global para escutar. O que existe é o store Vuex,
  // onde o app mantém o estado da chamada (callActive, callPhase, callDisplay,
  // callIsIncoming…). Observamos esse estado e traduzimos as TRANSIÇÕES em
  // eventos — derivar de estado é mais estável que caçar nomes de evento
  // internos, que mudam a cada build do bundle.
  ;(function watchCallState() {
    var prev = null

    function snapshot(st) {
      return {
        active: !!(st.callActive || st.callPhase),
        phase: st.callPhase || null,
        incoming: !!st.callIsIncoming,
        number: st.callDisplay || null,
      }
    }

    function describe(s) {
      return { id: null, number: s.number, direction: s.incoming ? 'inbound' : 'outbound' }
    }

    function tick(store) {
      var now = snapshot(store.state || {})

      if (!prev) { prev = now; return }

      // Começou uma chamada.
      if (now.active && !prev.active) {
        bridge.emit(now.incoming ? 'call:incoming' : 'call:dialing', describe(now))
      }
      // Foi atendida: sai de ringing/dialing para um estado de conversa.
      if (now.active && prev.active && now.phase !== prev.phase &&
          /answer|establish|active|talking|confirmed/i.test(String(now.phase))) {
        bridge.emit('call:answered', describe(now))
      }
      // Terminou.
      if (!now.active && prev.active) {
        bridge.emit('call:ended', describe(prev))
      }
      prev = now
    }

    waitFor(findStore, 30000).then(function (store) {
      bridge.emit('state', { state: 'ready' })
      if (typeof store.subscribe === 'function') {
        // subscribe dispara a cada mutation: reage na hora, sem polling.
        store.subscribe(function () { tick(store) })
      }
      // Rede de segurança: nem toda mudança relevante passa por mutation.
      setInterval(function () { tick(store) }, 500)
    }).catch(function (err) {
      console.warn('[bp-bridge] store não encontrado; eventos de chamada ficam indisponíveis:', err.message)
      bridge.emit('error', { message: 'estado de chamada indisponível: ' + err.message })
    })
  })()

  // --- arraste a partir de DENTRO do iframe ---------------------------------
  // O host é cross-origin e não pode tocar neste DOM, então a detecção do
  // arraste tem de acontecer aqui e viajar como delta pela ponte. É isso que
  // permite arrastar o webphone pela própria UI, sem barra de título externa.
  ;(function enableInnerDrag() {
    // Qualquer coisa clicável continua clicável: só o "fundo" arrasta.
    var INTERACTIVE = 'input,button,a,select,textarea,label,option,[contenteditable],[role="button"],[role="tab"],[role="link"],[draggable="true"]'
    var dragging = false

    document.addEventListener('pointerdown', function (ev) {
      if (ev.button !== 0) return
      if (!ev.target || (ev.target.closest && ev.target.closest(INTERACTIVE))) return
      // Se o usuário está selecionando texto, não sequestra o gesto.
      var sel = window.getSelection && window.getSelection()
      if (sel && String(sel).length) return

      dragging = true
      // cx/cy: posicao dentro do iframe. O host soma a posicao da janela e
      // descobre onde o cursor esta na viewport dele — e nao pode calcular
      // isso sozinho, por ser cross-origin.
      bridge.emit('drag:start', { x: ev.screenX, y: ev.screenY, cx: ev.clientX, cy: ev.clientY })
      try { document.documentElement.setPointerCapture(ev.pointerId) } catch (_) {}
    }, true)

    document.addEventListener('pointermove', function (ev) {
      if (!dragging) return
      // screenX/screenY são absolutos na tela: imunes ao próprio iframe se
      // mover durante o arraste, o que clientX/clientY não seriam.
      bridge.emit('drag:move', { x: ev.screenX, y: ev.screenY })
    }, true)

    function stop(ev) {
      if (!dragging) return
      dragging = false
      bridge.emit('drag:end', {})
      try { document.documentElement.releasePointerCapture(ev.pointerId) } catch (_) {}
    }
    document.addEventListener('pointerup', stop, true)
    document.addEventListener('pointercancel', stop, true)
  })()

  // Sinaliza pronto assim que o DOM do app existir.
  function announceReady() {
    // Identifica o HOST, não o SDK: são artefatos com ciclos separados.
    post({ type: 'ready', payload: { host: 'bravophone-embed' } })
  }
  if (document.readyState === 'complete') announceReady()
  else window.addEventListener('load', announceReady)
})()
