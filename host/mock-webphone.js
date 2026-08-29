/*!
 * mock-webphone.js — webphone falso para testar o SDK sem SIP nem backend.
 *
 * Reproduz o contrato REAL do popup.js, que não expõe nada em window:
 *   · escuta chrome.runtime.onMessage com method 'webphoneDialNow' (discagem)
 *   · publica um emitter (mitt) e um store Vuex em #app.__vue_app__
 *
 * Com isso o guest-bridge.js e o chrome-shim.js usados aqui são os MESMOS de
 * produção — o que está sendo testado é o caminho real, só o bundle é trocado.
 */
;(function () {
  'use strict'

  var handlers = {}
  var ui = {}

  var lwp = {
    on: function (evt, fn) {
      (handlers[evt] = handlers[evt] || []).push(fn)
    },
    emit: function (evt, data) {
      ;(handlers[evt] || []).forEach(function (fn) {
        try { fn(lwp, null, data) } catch (e) { console.error('[mock]', e) }
      })
    },
    isRegistered: function () { return true },
  }

  var dialpad = {
    inCall: false,
    currentNumber: null,

    call: function (number, meta) {
      if (this.inCall) throw new Error('já existe uma chamada em andamento')
      this.inCall = true
      this.currentNumber = number
      log('→ discando ' + number)
      setState('ringing', 'Chamando ' + number + '…')
      window.__bpMockStore.commit('setCall',
        { callActive: true, callPhase: 'dialing', callDisplay: number, callIsIncoming: false })

      // Atende sozinho depois de 2s para exercitar o ciclo completo.
      clearTimeout(this._t)
      this._t = setTimeout(function () {
        if (!dialpad.inCall) return
        window.__bpMockStore.commit('setCall', { callPhase: 'answered' })
        setState('incall', 'Em chamada com ' + number)
        log('✓ atendida')
      }, 2000)
      return Promise.resolve(true)
    },

    hangup: function () {
      if (!this.inCall) { log('· nada para desligar'); return Promise.resolve(false) }
      clearTimeout(this._t)
      var n = this.currentNumber
      this.inCall = false
      this.currentNumber = null
      window.__bpMockStore.commit('setCall',
        { callActive: false, callPhase: null, callDisplay: null, callIsIncoming: false })
      setState('ready', 'Pronto')
      log('■ desligada')
      return Promise.resolve(true)
    },

    answer: function () {
      if (!this.inCall) return Promise.resolve(false)
      clearTimeout(this._t)
      window.__bpMockStore.commit('setCall', { callPhase: 'answered' })
      setState('incall', 'Em chamada com ' + this.currentNumber)
      log('✓ atendida (manual)')
      return Promise.resolve(true)
    },

    mute: function (on) { log('🔇 mute=' + !!on); return Promise.resolve(true) },
    hold: function (on) { log('⏸ hold=' + !!on); return Promise.resolve(true) },
    sendDTMF: function (t) { log('☎ DTMF ' + t); return Promise.resolve(true) },
    transfer: function (to) { log('↪ transferindo para ' + to); return Promise.resolve(true) },
  }

  /** Simula uma chamada entrante — o caso que abre a janela sozinha no host. */
  function simulateIncoming(number) {
    if (dialpad.inCall) { log('· já em chamada'); return }
    dialpad.inCall = true
    dialpad.currentNumber = number
    window.__bpMockStore.commit('setCall',
      { callActive: true, callPhase: 'ringing', callDisplay: number, callIsIncoming: true })
    setState('ringing', 'Chamada de ' + number)
    log('◀ chamada entrante de ' + number)
  }

  function setState(state, text) {
    if (ui.state) { ui.state.dataset.s = state; ui.state.textContent = text }
  }

  function log(msg) {
    console.log('[mock-webphone]', msg)
    if (!ui.log) return
    ui.log.textContent += new Date().toLocaleTimeString() + '  ' + msg + '\n'
    ui.log.scrollTop = 1e9
  }

  // --- espelha o contrato REAL do popup.js -------------------------------
  // O bundle nao expoe globais: ele escuta chrome.runtime.onMessage com
  // method 'webphoneDialNow' e publica um emitter (mitt) + store Vuex via
  // app.provide(). O mock reproduz isso para exercitar o guest-bridge de
  // verdade, em vez de um atalho que so existe no teste.

  var emitterHandlers = {}
  var emitter = {
    all: emitterHandlers,
    on: function (e, fn) { (emitterHandlers[e] = emitterHandlers[e] || []).push(fn) },
    off: function (e, fn) {
      var l = emitterHandlers[e] || []
      var i = l.indexOf(fn)
      if (i !== -1) l.splice(i, 1)
    },
    emit: function (e, arg) { (emitterHandlers[e] || []).forEach(function (fn) { fn(arg) }) },
  }

  var subscribers = []
  var store = {
    state: { callActive: false, callPhase: null, callDisplay: null, callIsIncoming: false,
             callMuted: false, callHeld: false },
    commit: function (type, payload) {
      if (type === 'setCall') Object.assign(store.state, payload)
      subscribers.forEach(function (fn) { fn({ type: type, payload: payload }, store.state) })
    },
    subscribe: function (fn) { subscribers.push(fn) },
  }

  // Acoes em chamada chegam pelo emitter, como no bundle real.
  emitter.on('call-hangup', function () { dialpad.hangup() })
  emitter.on('call-answer', function () { dialpad.answer() })
  emitter.on('call-toggle-mute', function () {
    store.commit('setCall', { callMuted: !store.state.callMuted })
    log('🔇 mute=' + store.state.callMuted)
  })
  emitter.on('call-toggle-hold', function () {
    store.commit('setCall', { callHeld: !store.state.callHeld })
    log('⏸ hold=' + store.state.callHeld)
  })
  emitter.on('webphone-dial-key', function (t) { log('☎ DTMF ' + t) })
  emitter.on('webphone-transfer-initiated', function (to) { log('↪ transferindo para ' + to) })

  // Discagem chega por mensagem, exatamente como no click-to-call dos CRMs.
  chrome.runtime.onMessage.addListener(function (msg, _sender, reply) {
    if (!msg || msg.method !== 'webphoneDialNow') return
    var p = msg.payload || {}
    log('◀ webphoneDialNow ' + p.phone + (p.gateway ? ' (' + p.gateway + ')' : ''))
    dialpad.call(p.phone, p)
    reply({})
    return true
  })

  window.__bpMockStore = store
  window.__bpMockEmitter = emitter
  window.libwebphone = lwp
  window.dialpad = dialpad

  document.addEventListener('DOMContentLoaded', function () {
    // Publicado so agora: no <head> o #app ainda nao existe. E' tambem quando
    // o Vue real publicaria, ao montar.
    var appEl = document.getElementById('app')
    if (appEl) {
      appEl.__vue_app__ = {
        _context: { provides: { emitterKey: emitter, storeKey: store } },
        config: { globalProperties: {} },
      }
    }

    ui.state = document.getElementById('state')
    ui.log = document.getElementById('log')
    ui.token = document.getElementById('token')

    document.getElementById('incoming').onclick = function () {
      simulateIncoming(document.getElementById('inNum').value || '1133334444')
    }
    document.getElementById('hangup').onclick = function () { dialpad.hangup() }

    // Mostra o token que o SDK gravou via chrome-shim → prova que o
    // caminho init({token}) → bridge → storage funcionou.
    setInterval(function () {
      chrome.storage.local.get('vxToken', function (r) {
        ui.token.textContent = r.vxToken ? r.vxToken : '(nenhum)'
      })
    }, 500)

    setState('ready', 'Pronto')
    log('mock pronto · shim ' + (window.__bpShimActive ? 'ATIVO' : 'AUSENTE'))

    // Avisa o host que o registro SIP "subiu".
    setTimeout(function () { lwp.emit('userAgent.registered', {}) }, 300)
  })
})()
