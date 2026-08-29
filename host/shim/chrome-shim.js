/*!
 * chrome-shim.js — implementa a superfície de `chrome.*` que o bundle do
 * webphone usa, para que popup.js rode numa página comum, fora da extensão.
 *
 * PRECISA carregar ANTES de libwebphone.js e popup.js.
 *
 * Superfície coberta (levantada do popup.js / bravophone-route-selector.js /
 * bravophone-noise-suppressor.js da extensão):
 *   chrome.storage.sync|local|session .get .set .remove .clear .onChanged
 *   chrome.runtime .onMessage .sendMessage .lastError .getURL .id
 *   chrome.tabs .create .sendMessage
 *   chrome.windows .create .update .get .getCurrent
 */
;(function () {
  'use strict'
  // Se estivermos dentro da extensão real, não toca em nada.
  if (window.chrome && window.chrome.storage && window.chrome.runtime && window.chrome.runtime.id) return

  var PREFIX = 'bp.'
  var listeners = { storage: [], message: [] }

  // Aceita callback OU Promise, como a API MV3 faz.
  function settle(cb, value) {
    if (typeof cb === 'function') { cb(value); return Promise.resolve(value) }
    return Promise.resolve(value)
  }

  function makeArea(area) {
    var ns = PREFIX + area + '.'

    function readKey(key) {
      var raw = localStorage.getItem(ns + key)
      if (raw === null) return undefined
      try { return JSON.parse(raw) } catch (_) { return raw }
    }

    function allKeys() {
      var out = []
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i)
        if (k && k.indexOf(ns) === 0) out.push(k.slice(ns.length))
      }
      return out
    }

    return {
      get: function (keys, cb) {
        if (typeof keys === 'function') { cb = keys; keys = null }
        var result = {}
        try {
          if (keys === null || keys === undefined) {
            allKeys().forEach(function (k) { result[k] = readKey(k) })
          } else if (typeof keys === 'string') {
            var v = readKey(keys)
            if (v !== undefined) result[keys] = v
          } else if (Array.isArray(keys)) {
            keys.forEach(function (k) {
              var val = readKey(k)
              if (val !== undefined) result[k] = val
            })
          } else if (typeof keys === 'object') {
            // objeto = mapa de defaults
            Object.keys(keys).forEach(function (k) {
              var val = readKey(k)
              result[k] = val === undefined ? keys[k] : val
            })
          }
        } catch (err) { console.warn('[bp-shim] storage.get:', err) }
        return settle(cb, result)
      },

      set: function (items, cb) {
        var changes = {}
        try {
          Object.keys(items || {}).forEach(function (k) {
            var oldValue = readKey(k)
            localStorage.setItem(ns + k, JSON.stringify(items[k]))
            changes[k] = { oldValue: oldValue, newValue: items[k] }
          })
        } catch (err) {
          // Cota estourada é o caso real aqui (localStorage ~5 MB por origem).
          console.warn('[bp-shim] storage.set:', err)
        }
        fireStorage(changes, area)
        return settle(cb, undefined)
      },

      remove: function (keys, cb) {
        var list = Array.isArray(keys) ? keys : [keys]
        var changes = {}
        list.forEach(function (k) {
          changes[k] = { oldValue: readKey(k) }
          localStorage.removeItem(ns + k)
        })
        fireStorage(changes, area)
        return settle(cb, undefined)
      },

      clear: function (cb) {
        var changes = {}
        allKeys().forEach(function (k) {
          changes[k] = { oldValue: readKey(k) }
          localStorage.removeItem(ns + k)
        })
        fireStorage(changes, area)
        return settle(cb, undefined)
      },
    }
  }

  function fireStorage(changes, area) {
    if (!changes || !Object.keys(changes).length) return
    listeners.storage.forEach(function (fn) {
      try { fn(changes, area) } catch (err) { console.error('[bp-shim] onChanged:', err) }
    })
  }

  function makeEvent(bucket) {
    return {
      addListener: function (fn) { if (bucket.indexOf(fn) === -1) bucket.push(fn) },
      removeListener: function (fn) {
        var i = bucket.indexOf(fn)
        if (i !== -1) bucket.splice(i, 1)
      },
      hasListener: function (fn) { return bucket.indexOf(fn) !== -1 },
      hasListeners: function () { return bucket.length > 0 },
    }
  }

  function bridgeEmit(name, payload) {
    if (window.__bpBridge && typeof window.__bpBridge.emit === 'function') {
      window.__bpBridge.emit(name, payload)
    }
  }

  var chromeShim = {
    storage: {
      sync: makeArea('sync'),
      local: makeArea('local'),
      session: makeArea('session'),
      onChanged: makeEvent(listeners.storage),
    },

    runtime: {
      id: 'bravophone-embed',
      // lastError sempre undefined: sem IPC, não há erro assíncrono de canal.
      lastError: undefined,
      getURL: function (path) {
        return new URL(String(path).replace(/^\/+/, ''), document.baseURI).href
      },
      onMessage: makeEvent(listeners.message),
      sendMessage: function (a, b, c) {
        // Assinaturas: (msg), (msg, cb), (extId, msg), (extId, msg, cb)
        var msg = typeof a === 'string' && b !== undefined ? b : a
        var cb = typeof c === 'function' ? c : typeof b === 'function' ? b : undefined
        var responded = false
        var reply = function (r) { if (!responded) { responded = true; if (cb) cb(r) } }
        listeners.message.forEach(function (fn) {
          try { fn(msg, { id: 'bravophone-embed', url: location.href }, reply) } catch (err) {
            console.error('[bp-shim] onMessage:', err)
          }
        })
        if (!responded) reply(undefined)
        return Promise.resolve(undefined)
      },
      connect: function () {
        return {
          postMessage: function () {},
          disconnect: function () {},
          onMessage: makeEvent([]),
          onDisconnect: makeEvent([]),
        }
      },
      getManifest: function () { return { version: '0.1.0', name: 'Bravophone Embed' } },
    },

    tabs: {
      // No embed não há abas: abrir link vira uma nova aba do browser mesmo.
      create: function (props, cb) {
        var win = window.open(props && props.url, '_blank', 'noopener,noreferrer')
        return settle(cb, { id: Date.now(), url: props && props.url, window: win ? 1 : 0 })
      },
      query: function (_q, cb) { return settle(cb, []) },
      sendMessage: function (_tabId, msg, cb) { return chromeShim.runtime.sendMessage(msg, cb) },
      update: function (_id, _props, cb) { return settle(cb, {}) },
    },

    windows: {
      // A "janela" agora é o widget arrastável no host: estes stubs mantêm o
      // bundle funcionando e delegam ao host o que faz sentido.
      WINDOW_ID_CURRENT: -2,
      create: function (props, cb) {
        bridgeEmit('window:create', props)
        return settle(cb, Object.assign({ id: 1 }, props))
      },
      update: function (id, props, cb) {
        if (props && (props.width || props.height)) {
          bridgeEmit('window:resize', { width: props.width, height: props.height })
        }
        if (props && props.focused) bridgeEmit('window:focus', {})
        return settle(cb, Object.assign({ id: id }, props))
      },
      get: function (id, info, cb) {
        var callback = typeof info === 'function' ? info : cb
        return settle(callback, { id: id, width: window.innerWidth, height: window.innerHeight })
      },
      getCurrent: function (info, cb) {
        var callback = typeof info === 'function' ? info : cb
        return settle(callback, {
          id: 1,
          width: window.innerWidth,
          height: window.innerHeight,
          focused: document.hasFocus(),
        })
      },
      remove: function (_id, cb) {
        bridgeEmit('window:close', {})
        return settle(cb, undefined)
      },
    },

    contextMenus: { create: function () {}, removeAll: function (cb) { return settle(cb, undefined) } },
    scripting: { executeScript: function (_o, cb) { return settle(cb, []) } },
    action: {
      setBadgeText: function (_o, cb) { return settle(cb, undefined) },
      setIcon: function (_o, cb) { return settle(cb, undefined) },
    },
    i18n: {
      /**
       * As mensagens vêm de shim/messages.js, gerado do _locales/ da extensão.
       * O bundle expõe `t(k){ return chrome.i18n.getMessage(k) }` e os
       * templates usam isso para quase todo label — sem estas mensagens a
       * interface renderiza sem texto nenhum.
       */
      getMessage: function (key, substitutions) {
        var table = window.__bpMessages
        if (!table) {
          if (!chromeShim.i18n._warned) {
            chromeShim.i18n._warned = true
            console.error('[bp-shim] __bpMessages ausente: a UI vai aparecer sem textos. ' +
              'Rode `npm run sync` para gerar shim/messages.js.')
          }
          return ''
        }
        var entry = table[key]
        if (!entry) return ''
        var msg = entry.message || ''

        // Placeholders nomeados do messages.json: "$USER$" -> content "$1".
        if (entry.placeholders) {
          Object.keys(entry.placeholders).forEach(function (name) {
            var ph = entry.placeholders[name]
            // A string precisa levar DUAS barras: '\\$' em JS produz '\$' na
            // regex, que é o cifrão literal. Com uma barra só, o $ chega cru à
            // regex e vira âncora de fim de linha — nada é substituído.
            var safe = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
            msg = msg.replace(
              new RegExp('\\$' + safe + '\\$', 'gi'),
              ph && ph.content != null ? String(ph.content) : ''
            )
          })
        }

        // Substituições posicionais: $1..$9.
        if (substitutions != null) {
          var list = Array.isArray(substitutions) ? substitutions : [substitutions]
          msg = msg.replace(/\$([1-9])/g, function (whole, i) {
            var v = list[Number(i) - 1]
            return v == null ? '' : String(v)
          })
        }

        // "$$" escapa um cifrão literal.
        return msg.replace(/\$\$/g, '$')
      },
      getUILanguage: function () { return window.__bpLocale || navigator.language || 'pt-BR' },
      getAcceptLanguages: function (cb) { return settle(cb, [navigator.language || 'pt-BR']) },
    },
  }

  window.chrome = window.chrome || {}
  Object.keys(chromeShim).forEach(function (k) {
    if (!window.chrome[k]) window.chrome[k] = chromeShim[k]
  })
  window.browser = window.browser || window.chrome
  window.__bpShimActive = true
})()
