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

  // A origem do pai chega de dois jeitos, conforme o modo:
  //   · hospedado  — query string (?parent=...), pois o iframe navega
  //   · srcdoc     — variável injetada, pois não há URL própria para carregar
  // Nos dois casos o servidor ainda valida a origem pela allowlist; isto aqui
  // sozinho nunca é garantia de nada.
  try {
    parentOrigin = window.__bpParentOrigin ||
      new URLSearchParams(location.search).get('parent')
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

  /**
   * Procura um objeto na aplicação Vue, por FORMA e não por nome.
   *
   * Onde procurar não é escolha nossa. O bundle faz `setup() { return {
   * emitter: $h } }` — o emitter é uma variável de módulo devolvida pelo
   * setup, então ele NÃO está em `provides` nem em `globalProperties`. Ele
   * vive no `setupState` de cada componente que o devolve.
   *
   * Procurar só nos dois primeiros lugares é o que fazia `findEmitter`
   * devolver null para sempre — e com ele hangup, answer, mute, hold,
   * transfer e o teclado nunca chegavam ao app.
   *
   * A varredura cobre, em ordem de custo:
   *   1. provides e globalProperties (onde o store fica);
   *   2. setupState da instância raiz e da árvore de componentes;
   *   3. os elementos do DOM, via __vueParentComponent.
   */
  function procurarNaApp(combina) {
    var app = vueApp()
    if (!app) return null

    // 1. onde o Vuex costuma estar
    var pools = []
    if (app._context) {
      if (app._context.provides) pools.push(app._context.provides)
      if (app._context.config && app._context.config.globalProperties) {
        pools.push(app._context.config.globalProperties)
      }
    }
    if (app.config && app.config.globalProperties) pools.push(app.config.globalProperties)

    for (var i = 0; i < pools.length; i++) {
      for (var k in pools[i]) {
        try { if (combina(pools[i][k])) return pools[i][k] } catch (_) {}
      }
    }

    // 2. a árvore de componentes
    var achado = varrerInstancia(app._instance, 0)
    if (achado) return achado

    // 3. os elementos renderizados: alcança componentes fora da subTree
    //    principal (teleports, por exemplo)
    var els = document.querySelectorAll('#app, #app *')
    for (var j = 0; j < els.length && j < 400; j++) {
      var inst = els[j].__vueParentComponent
      var r = inst && inspecionarInstancia(inst, combina)
      if (r) return r
    }
    return null

    function inspecionarInstancia(inst, testa) {
      if (!inst) return null
      var fontes = [inst.setupState, inst.ctx, inst.proxy, inst.data]
      for (var a = 0; a < fontes.length; a++) {
        var f = fontes[a]
        if (!f) continue
        // `ctx` e `proxy` são Proxies: enumerar tudo pode disparar getters
        // caros. Olhamos as chaves que interessam primeiro.
        for (var key in f) {
          try { if (testa(f[key])) return f[key] } catch (_) {}
        }
      }
      return null
    }

    function varrerInstancia(inst, nivel) {
      if (!inst || nivel > 12) return null
      var r = inspecionarInstancia(inst, combina)
      if (r) return r
      var sub = inst.subTree
      return sub ? varrerVNode(sub, nivel + 1) : null
    }

    function varrerVNode(vnode, nivel) {
      if (!vnode || nivel > 12) return null
      if (vnode.component) {
        var r = varrerInstancia(vnode.component, nivel)
        if (r) return r
      }
      var filhos = vnode.children
      if (Array.isArray(filhos)) {
        for (var i2 = 0; i2 < filhos.length; i2++) {
          var r2 = varrerVNode(filhos[i2], nivel + 1)
          if (r2) return r2
        }
      }
      return null
    }
  }


  // O EMITTER NAO E ALCANCAVEL, e por isso nao ha mais nada aqui.
  //
  // Havia um findEmitter() e um relatorio de diagnostico que varria a arvore
  // atras dele. A varredura foi feita no navegador e a resposta e definitiva:
  // nesta build de producao do Vue, `app._instance` e false e nenhum elemento
  // tem `__vueParentComponent` - o emitter e uma variavel de modulo devolvida
  // pelo setup(), sem caminho de API ate ela.
  //
  // As acoes em chamada passaram a clicar os botoes da tela (ver mais abaixo),
  // que e como o usuario faz. Se alguem for tentado a reintroduzir o emitter,
  // a medida ja foi feita: nao existe.

  function findStore() {
    return procurarNaApp(function (v) {
      return v && v.state && typeof v.commit === 'function'
    })
  }

  // --- ações em chamada, por clique -------------------------------------
  //
  // POR QUE NÃO PELO EMITTER: estes seis emitiam em `call-hangup`,
  // `call-toggle-mute` e companhia. O emitter é uma variável de módulo
  // devolvida pelo `setup()`, e esta é uma build de PRODUÇÃO do Vue — medido
  // no navegador, `app._instance` é false e não há um único elemento com
  // `__vueParentComponent`. Não existe caminho de API até ele: os comandos
  // esperavam 20s e rejeitavam. Nenhum deles nunca funcionou.
  //
  // Clicar o botão da tela usa exatamente o caminho do usuário, e é o próprio
  // app que emite no emitter dele — que ali dentro é alcançável.
  //
  // O PREÇO: dependemos do DOM da tela de chamada. Os ganchos escolhidos são
  // os mais estáveis que existem — a classe `call-screen`, a classe
  // `call-action` do componente de ação, e o `title`/rótulo que vem do i18n —
  // mas isto quebra se a tela for redesenhada. É o mesmo trato do teclado.

  /** Espera o botão aparecer e clica. Erro claro quando ele não vem. */
  function clicarBotao(procurar, oQue, prazo) {
    return waitFor(procurar, prazo || 6000).then(function (btn) {
      if (btn.disabled) throw new Error('indisponivel no estado atual da chamada')
      btn.click()
      return { ok: true }
    }).catch(function (err) {
      throw new Error('nao consegui ' + oQue + ': ' + (err && err.message ? err.message : err))
    })
  }

  /** Botão da tela de chamada com este título do i18n (desligar, atender). */
  function porTitulo(chave, alternativa) {
    return function () {
      var alvo = (chrome.i18n.getMessage(chave) || alternativa || '').trim().toLowerCase()
      if (!alvo) return null
      var btns = document.querySelectorAll('.call-screen button[title]')
      for (var i = 0; i < btns.length; i++) {
        if ((btns[i].getAttribute('title') || '').toLowerCase().indexOf(alvo) >= 0) return btns[i]
      }
      return null
    }
  }

  /**
   * Ação da grade (mudo, espera, transferir).
   *
   * Pelo rótulo, e não pela posição: o de mudo alterna entre "Silenciar" e
   * "Ativar som" conforme o estado, então as duas chaves entram na busca.
   */
  function porAcao(chaves) {
    return function () {
      var alvos = []
      for (var i = 0; i < chaves.length; i++) {
        var t = (chrome.i18n.getMessage(chaves[i]) || '').trim().toLowerCase()
        if (t) alvos.push(t)
      }
      if (!alvos.length) return null
      var btns = document.querySelectorAll('.call-screen button.call-action')
      for (var j = 0; j < btns.length; j++) {
        var txt = (btns[j].textContent || '').trim().toLowerCase()
        for (var k = 0; k < alvos.length; k++) {
          if (txt && txt.indexOf(alvos[k]) >= 0) return btns[j]
        }
      }
      return null
    }
  }

  /** Tecla do teclado numérico, para DTMF durante a chamada. */
  function teclaDoPad(c) {
    return function () {
      var pad = document.querySelector('.keypad')
      if (!pad) return null
      var btns = pad.querySelectorAll('button')
      for (var i = 0; i < btns.length; i++) {
        // O botão mostra o dígito e às vezes as letras ("2ABC").
        var txt = (btns[i].textContent || '').trim()
        if (txt && txt.charAt(0) === c) return btns[i]
      }
      return null
    }
  }

  // --- comandos aceitos do site hospedeiro ---
  var commands = {
    // As chaves saem do bpSaveSession do bundle — é ele quem define os nomes.
    // Gravar 'vxToken' não serve para nada: ninguém lê essa chave.
    auth: function (p) {
      var s = (p && p.session) || (p && p.token ? { vxToken: p.token } : null)
      if (!s || !s.vxToken) throw new Error('sessão ausente (precisa ao menos de vxToken)')

      var dados = {
        bravophoneVxToken: s.vxToken,
        bravophoneVxTokenExpiresAt: s.expiresIn
          ? Date.now() + 1000 * Number(s.expiresIn) : null,
        bravophoneSip: s.sip || null,
        bravophoneTenant: s.tenant || null,
        bravophoneRamal: s.ramal || null,
        bravophoneClienteId: s.clienteId || null,
        bravophoneRamaisUrl: s.ramaisUrl || null,
      }
      Object.keys(dados).forEach(function (k) { if (dados[k] === null) delete dados[k] })

      return new Promise(function (resolve, reject) {
        chrome.storage.local.set(dados, function () {
          // O ramal NÃO vai para o storage: o bundle o mantém apenas no store
          // Vuex (mutation addExtension), em memória. E o checkToken exige as
          // DUAS metades — `vxToken` da sessão E `extension` com username e
          // password. Só a sessão deixa o app na tela de login.
          // O status vem do login; sem ele, deduz pela presença do extension.
          aplicarStatusRamal(s.extensionStatus ||
            { hasExtension: !!s.extension, reason: s.extension ? 'ok' : 'no_extension_assigned' })

          if (!s.extension) return resolve({ ok: true, extension: false })

          waitFor(findStore, 20000).then(function (store) {
            // Depois da sessão gravada, de propósito: a mutation relê o
            // storage para decidir se está logado.
            store.commit('addExtension', s.extension)
            resolve({ ok: true, extension: true })
          }).catch(function (err) {
            reject(new Error('sessão gravada, mas o ramal não pôde ser aplicado: ' + err.message))
          })
        })
      })
    },

    logout: function () {
      var CHAVES = ['bravophoneVxToken', 'bravophoneVxTokenExpiresAt', 'bravophoneSip',
                    'bravophoneTenant', 'bravophoneRamal', 'bravophoneClienteId',
                    'bravophoneRamaisUrl']
      return new Promise(function (resolve) {
        chrome.storage.local.remove(CHAVES, function () { resolve({ ok: true }) })
      })
    },

    call: function (p) {
      if (!p || !p.number) throw new Error('número ausente')
      // Sem ramal a mensagem chega ao integrador, que decide o que mostrar.
      // Antes disto o webphone simplesmente não fazia nada.
      if (window.__bpSemRamal()) {
        throw new Error('sem ramal atribuído: não é possível fazer ligações')
      }
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

    hangup: function () {
      return clicarBotao(porTitulo('webphoneCallHangup', 'desligar'), 'desligar')
    },
    answer: function () {
      // O botão de atender só existe enquanto a chamada está entrando.
      return clicarBotao(porTitulo('webphoneCallAnswer', 'atender'), 'atender')
    },
    // mute/hold do bundle são TOGGLE: não aceitam estado alvo. E os dois ficam
    // desabilitados fora de "connected" — o clique devolve isso como erro.
    mute: function () {
      return clicarBotao(porAcao(['callActionMute', 'callActionMuted']), 'silenciar')
    },
    hold: function () {
      return clicarBotao(porAcao(['callActionHold', 'callActionResume']), 'colocar em espera')
    },

    dtmf: function (p) {
      if (!p || p.tone == null) throw new Error('tom ausente')
      var tons = String(p.tone).replace(/[^0-9*#]/g, '')
      if (!tons) throw new Error('tom invalido: use 0-9, * ou #')
      // Um de cada vez, na ordem. Durante a chamada o teclado volta a ser do
      // bundle (o bravophone-input.js se cala), e cada clique vira DTMF.
      var fila = Promise.resolve({ ok: true })
      tons.split('').forEach(function (c) {
        fila = fila.then(function () {
          return clicarBotao(teclaDoPad(c), 'enviar o tom ' + c, 2000)
        })
      })
      return fila.then(function () { return { ok: true, tones: tons } })
    },

    /**
     * Transferir é dois passos na tela: abrir a lista e escolher o ramal.
     *
     * O painel carrega os ramais por rede, então o segundo waitFor tem prazo
     * maior. Um ramal offline ou em ligação vem desabilitado — o clique
     * devolve isso em vez de fingir que transferiu.
     */
    transfer: function (p) {
      if (!p || !p.to) throw new Error('destino ausente')
      var destino = String(p.to).replace(/\D/g, '')
      if (!destino) throw new Error('destino invalido: informe o ramal')

      return clicarBotao(porAcao(['callActionTransfer']), 'abrir a transferencia')
        .then(function () {
          return clicarBotao(function () {
            var itens = document.querySelectorAll('.call-screen .space-y-2 button')
            for (var i = 0; i < itens.length; i++) {
              if ((itens[i].textContent || '').indexOf(destino) >= 0) return itens[i]
            }
            return null
          }, 'achar o ramal ' + destino + ' na lista', 12000)
        })
        .then(function () { return { ok: true, to: destino } })
    },

    clearDial: function () {
      return clicarBotao(function () {
        var alvo = (chrome.i18n.getMessage('globalClear') || 'limpar').toLowerCase()
        var btns = document.querySelectorAll('button')
        for (var i = 0; i < btns.length; i++) {
          if ((btns[i].textContent || '').trim().toLowerCase() === alvo) return btns[i]
        }
        return null
      }, 'limpar o numero')
    },

    status: function () {
      var store = findStore()
      var st = (store && store.state) || {}
      return Promise.resolve({
        // Prontidao pelo store, e nao pelo emitter: ele nao e
        // alcancavel em build de producao, e `ready` vinha sempre false.
        ready: !!findStore(),
        inCall: !!(st.callActive || st.callPhase),
        phase: st.callPhase || null,
        number: st.callDisplay || null,
        incoming: !!st.callIsIncoming,
        muted: !!st.callMuted,
        held: !!st.callHeld,
      })
    },

    /** Recebe o extensionStatus do polling que o SDK faz. */
    extensionStatus: function (p) {
      if (p && p.buscando !== undefined) {
        marcarBuscando(p.buscando)
        if (!p.status) return { ok: true }
      }
      aplicarStatusRamal(p && p.status)
      return { ok: true, semRamal: !!window.__bpSemRamal() }
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

  // --- aviso de "sem ramal" --------------------------------------------------
  //
  // Sem ramal SIP o webphone entra normalmente (histórico, contatos,
  // configurações) mas não disca: o botão vem com `disabled: !canDial` e o
  // método dial() faz `canDial && emit(...)`, então clicar não produz efeito
  // nem evento. Sem aviso, o usuário digita, aperta e nada acontece.
  //
  // O banner vive dentro do iframe, junto do que o usuário está olhando.

  /**
   * Mede a coluna do discador e guarda em --bp-painel-larg.
   *
   * O shell e um flex-row: .webphone-shell-main tem largura propria (380px) e o
   * painel de recentes fica ao lado. Os avisos sao position:fixed, entao sem
   * essa medida eles se esticam pela janela inteira e passam por cima do painel
   * vizinho. Medimos em vez de fixar 380 porque a largura e do bundle, nao
   * nossa - se ela mudar la, os avisos acompanham.
   */
  function medirPainel() {
    var painel = document.querySelector('.webphone-shell-main')
    if (!painel) return false
    var larg = painel.offsetWidth
    if (larg > 0) document.body.style.setProperty('--bp-painel-larg', larg + 'px')
    return larg > 0
  }

  // O app demora alguns quadros para renderizar; paramos assim que medirmos.
  ;(function acompanharPainel() {
    var tentativas = 0
    var timer = setInterval(function () {
      if (medirPainel() || ++tentativas > 40) clearInterval(timer)
    }, 250)
    window.addEventListener('resize', medirPainel)
  })()

  // --- os avisos do app -------------------------------------------------
  //
  // O bundle usa Vue-Toastification com o tema de fabrica: retangulos chapados
  // em #ff5252 / #ffc107 / #4caf50 / #2196f3, texto branco de 16px em Lato,
  // 64px de altura minima, 326px de largura minima e um X de 24px. Nada disso
  // conversa com um painel escuro de 380px - e o mesmo motivo pelo qual o
  // aviso de ramal precisou ser refeito.
  //
  // Aqui eles passam a usar a mesma linguagem do cartao: superficie escura,
  // borda de 1px, canto de 10px, sombra larga e 11.5px de texto. So o matiz
  // muda por tipo, e o de informacao usa o proprio painel do app.
  function estilizarToasts() {
    if (document.getElementById('bp-estilo-toasts')) return
    var css = document.createElement('style')
    css.id = 'bp-estilo-toasts'

    // fundo, borda, texto, icone
    var TIPOS = [
      ['error', '#241a20', '#5a2b33', '#ffb3b3', '#ff8a8a'],
      ['warning', '#241e16', '#5a4526', '#ffd7a3', '#ffb454'],
      ['success', '#16241d', '#26553d', '#a9e3c1', '#4ade80'],
      // Informacao e o painel do proprio app, com o roxo da marca no icone.
      ['info', '#1c2131', '#262c40', '#c8cee0', '#8b7cf8'],
      ['default', '#1c2131', '#262c40', '#c8cee0', '#8b7cf8']
    ]
    var porTipo = ''
    for (var i = 0; i < TIPOS.length; i++) {
      var t = TIPOS[i]
      porTipo +=
        '.Vue-Toastification__toast--' + t[0] + '{' +
        'background-color:' + t[1] + '!important;border-color:' + t[2] + '!important;' +
        'color:' + t[3] + '!important}' +
        '.Vue-Toastification__toast--' + t[0] + ' .Vue-Toastification__icon{' +
        'color:' + t[4] + '!important;fill:' + t[4] + '!important}'
    }

    css.textContent =
      // O container de fabrica tem 600px fixos; aqui a tela toda tem 380.
      '.Vue-Toastification__container{max-width:none!important;' +
      'width:calc(var(--bp-painel-larg,380px) - 16px)!important;' +
      'left:8px!important;right:auto!important;padding:0!important;' +
      'margin-left:0!important}' +

      '.Vue-Toastification__toast{min-height:0!important;min-width:0!important;' +
      'max-width:none!important;width:100%!important;' +
      'padding:9px 12px!important;margin-bottom:8px!important;' +
      'border-radius:10px!important;border:1px solid transparent;' +
      'box-shadow:0 10px 28px rgba(0,0,0,.5)!important;' +
      'font-family:system-ui,-apple-system,sans-serif!important;' +
      'align-items:center!important}' +

      '.Vue-Toastification__toast-body{font-size:11.5px!important;' +
      'line-height:1.45!important;font-weight:500!important}' +

      '.Vue-Toastification__icon{width:15px!important;height:15px!important;' +
      'margin:0 9px 0 0!important;flex:0 0 auto}' +

      // O X de 24px branco era a parte mais pesada do conjunto.
      '.Vue-Toastification__close-button{font-size:17px!important;' +
      'line-height:1!important;padding-left:10px!important;' +
      'color:inherit!important;opacity:.45!important;align-self:center}' +
      '.Vue-Toastification__close-button:hover{opacity:.9!important}' +

      // A barra de 5px branca virava uma tarja; 2px em cima da borda basta.
      '.Vue-Toastification__progress-bar{height:2px!important;' +
      'background-color:currentColor!important;opacity:.3!important}' +

      porTipo

    document.head.appendChild(css)
  }

  if (document.head) estilizarToasts()
  else document.addEventListener('DOMContentLoaded', estilizarToasts)

  var avisoEl = null
  var avisoTimer = null

  // Escritos com escapes de propósito: este arquivo é servido como estático e
  // pode ser interpretado com o charset errado, o que transforma acentos em
  // U+FFFD. Em \uXXXX o arquivo é ASCII e o texto sai certo em runtime.
  var TXT_SEM_RAMAL = 'Nenhum ramal atribu\u00eddo \u2014 n\u00e3o \u00e9 poss\u00edvel ligar.'
  var TXT_RELOGIN = 'Um ramal foi atribu\u00eddo a voc\u00ea. Entre novamente para usar o telefone.'
  var TXT_BLOQUEIO = 'Voc\u00ea n\u00e3o possui ramal configurado: n\u00e3o \u00e9 poss\u00edvel fazer liga\u00e7\u00f5es.'

  /** Usa o texto da API só se ele chegou íntegro. */
  function textoSeguro(vindoDaApi, padrao) {
    if (!vindoDaApi) return padrao
    return String(vindoDaApi).indexOf('\ufffd') >= 0 ? padrao : vindoDaApi
  }

  /**
   * Esconde o toast que o bundle levanta com a MESMA informacao.
   *
   * Ele e um Vue-Toastification com o texto de messageExtensionMissingConfig e
   * um X, e aparecia sobreposto ao nosso cartao: dois avisos dizendo a mesma
   * coisa, um deles fora da linguagem do app. O nosso ficou com o link, entao
   * nada se perde.
   *
   * Escondemos em vez de remover: o no e do Vue-Toastification, que ainda vai
   * mexer nele quando o tempo do toast acabar.
   */
  function esconderToastDoBundle() {
    var alvo = (chrome.i18n.getMessage('messageExtensionMissingConfig') || '')
      .slice(0, 40).trim()
    // Sem o texto do i18n nao da para distinguir este toast dos outros - e ha
    // um parecido para "ramal com dificuldade de registrar", que deve aparecer.
    if (alvo.length < 20) return
    var toasts = document.querySelectorAll('.Vue-Toastification__toast')
    for (var i = 0; i < toasts.length; i++) {
      if ((toasts[i].textContent || '').indexOf(alvo) < 0) continue
      toasts[i].style.setProperty('display', 'none', 'important')
    }
  }

  function montarAviso() {
    var css = document.createElement('style')
    // NÃO mexe no layout do app: empurrar o body ou encolher o #app tirava o
    // menu de abas da área visível, porque o webphone controla a própria
    // altura por dentro. O banner sobrepõe o cabeçalho, que é informativo.
    css.textContent =
      // Um cartao, e nao uma faixa sangrada: o mesmo vocabulario do menu de
      // sugestoes do app (fundo escuro, borda de 1px, canto de 10px, sombra
      // larga), so que deslocado para o vermelho. A faixa anterior atravessava
      // a tela inteira em cor chapada e nao pertencia a lugar nenhum.
      // Preso a coluna do discador: o shell e flex-row e o painel de recentes
      // fica ao lado, entao left/right soltos faziam o aviso atravessar os dois.
      '.bp-aviso-ramal{position:fixed;left:8px;top:8px;right:auto;' +
      'width:calc(var(--bp-painel-larg,380px) - 16px);z-index:2147483000;' +
      'display:flex;align-items:center;gap:9px;padding:9px 12px;' +
      'background:#241a20;border:1px solid #5a2b33;border-radius:10px;' +
      'color:#c9a6ab;font:500 11.5px/1.45 system-ui,-apple-system,sans-serif;' +
      'box-shadow:0 10px 28px rgba(0,0,0,.5)}' +
      // O aviso nao entra na arvore do Vue - ver reservarEspaco. Em vez
      // disso encolhemos o shell por dentro: como o Tailwind poe todo mundo
      // em border-box, um padding-top no elemento de altura fixa reduz a
      // area util, o conteudo (flex-1) encolhe e a barra de abas fica onde
      // estava. E a mesma coisa que inserir um irmao, sem mexer no DOM dele.
      // O container de toast do bundle e fixo em top:1em com z-index 9999, e
      // o cartao fica por cima dele: os outros avisos (microfone, por
      // exemplo) apareciam escondidos atras. Descemos o container pela mesma
      // altura que ja reservamos.
      'body.bp-sem-ramal .Vue-Toastification__container[class*="top-"]{' +
      'top:var(--bp-aviso-altura,58px)!important}' +
      'body.bp-sem-ramal .webphone-shell-main{' +
      'padding-top:var(--bp-aviso-altura,58px)!important}' +
      '.bp-aviso-ramal svg{flex:0 0 auto;width:15px;height:15px}' +
      '.bp-aviso-ramal > svg:first-child{color:#ff8a8a}' +
      '.bp-aviso-txt{min-width:0;color:#ffb3b3;font-weight:600}' +
      // No lugar do X: um ícone que gira enquanto consultamos a API. Fechar
      // não faz sentido aqui — o aviso descreve um estado, não um recado.
      '.bp-aviso-sync{margin-left:auto;flex:0 0 auto;width:14px;height:14px;' +
      'color:#c9a6ab;opacity:.45;transition:opacity .2s}' +
      '.bp-aviso-ramal.buscando .bp-aviso-sync{opacity:1;' +
      'animation:bp-sync 900ms linear infinite}' +
      '@keyframes bp-sync{to{transform:rotate(360deg)}}' +
      '@keyframes bp-chama{0%,100%{background:#241a20}50%{background:#43222c}}' +
      '.bp-aviso-ramal.chamando{animation:bp-chama 380ms ease-in-out 2}' +
      '@media (prefers-reduced-motion: reduce){' +
      '.bp-aviso-ramal.buscando .bp-aviso-sync,.bp-aviso-ramal.chamando{animation:none}}'
    document.head.appendChild(css)

    var el = document.createElement('div')
    el.className = 'bp-aviso-ramal'
    el.setAttribute('role', 'status')
    el.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round"><path d="M12 9v4"/><path d="M12 17h.01"/>' +
      '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>' +
      '<span class="bp-aviso-txt"></span>' +
      '<svg class="bp-aviso-sync" viewBox="0 0 24 24" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-2.6-6.4"/>' +
      '<path d="M21 3v6h-6"/></svg>'
    document.body.appendChild(el)
    return el
  }

  /**
   * Reserva espaco para o aviso sem encostar no DOM do Vue.
   *
   * A tentativa anterior inseria o cartao entre o <header> e o <main>, dentro
   * de .webphone-shell-main. Ficava bonito e quebrava tudo: aquela lista de
   * filhos e diffada pelo Vue, e o componente do webphone tem
   * `unmounted(){document.location.reload()}` - qualquer tropeco na remontagem
   * vira recarga da pagina, e a pagina recarregava em loop ao abrir.
   *
   * Empurrar o body tambem nao serve: o shell fixa a propria altura (100vh) e
   * ignora o que acontece fora dele. O que funciona e encolher o shell POR
   * DENTRO, com padding-top - a classe vai no <body>, que o Vue nao gerencia.
   */
  function reservarEspaco() {
    if (!avisoEl) return
    document.body.classList.add('bp-sem-ramal')
    medirPainel()
    // Medimos porque o texto varia de uma para duas linhas conforme a mensagem
    // que a API devolve.
    var altura = avisoEl.offsetHeight
    if (altura > 0) {
      document.body.style.setProperty('--bp-aviso-altura', (altura + 16) + 'px')
    }
  }

  function liberarEspaco() {
    document.body.classList.remove('bp-sem-ramal')
    document.body.style.removeProperty('--bp-aviso-altura')
  }

  function mostrarAvisoSemRamal(texto) {
    if (!avisoEl) avisoEl = montarAviso()
    avisoEl.querySelector('.bp-aviso-txt').textContent = texto
    reservarEspaco()
    // De novo no quadro seguinte: na primeira medida a fonte
    // pode nao ter carregado e o texto ocupa uma linha a menos.
    if (window.requestAnimationFrame) requestAnimationFrame(reservarEspaco)
    liberarBotaoDiscar()
  }

  function esconderAvisoSemRamal() {
    if (!avisoEl) return
    liberarEspaco()
    avisoEl.remove()
    avisoEl = null
  }

  /** Gira o ícone enquanto o SDK consulta o ramal na API. */
  function marcarBuscando(ativo) {
    if (!avisoEl) return
    avisoEl.classList.toggle('buscando', !!ativo)
  }

  // --- deixar o botão clicável, para o clique poder avisar --------------------
  //
  // O botão de discar nasce `disabled` quando canDial é falso. Elemento
  // desabilitado não emite clique, então não havia como reagir. Tiramos o
  // disabled e interceptamos: o dial() do bundle continua guardado por
  // `canDial &&`, então nada é discado de verdade.
  var observador = null

  function ehBotaoDiscar(btn) {
    if (!btn || btn.tagName !== 'BUTTON') return false
    // Nada dentro do campo de discagem e o botao de ligar. A comparacao
    // abaixo e por substring do title, entao qualquer botao nosso que fale
    // em "ligar" seria confundido - e ja foi.
    if (btn.closest && btn.closest('.bpi-wrap')) return false
    var t = (btn.getAttribute('title') || '') + ' ' + (btn.textContent || '')
    // O título vem do i18n (webphoneCallMake); comparamos pelo texto que o
    // próprio bundle usa, em vez de depender de classe minificada.
    var alvo = (chrome.i18n.getMessage('webphoneCallMake') || 'Ligar').toLowerCase()
    return t.toLowerCase().indexOf(alvo) >= 0
  }

  function liberarBotaoDiscar() {
    if (observador) return
    var aplicar = function () {
      if (!avisoEl) return
      esconderToastDoBundle()
      var botoes = document.querySelectorAll('button[disabled]')
      for (var i = 0; i < botoes.length; i++) {
        if (!ehBotaoDiscar(botoes[i])) continue
        botoes[i].disabled = false
        botoes[i].setAttribute('data-bp-sem-ramal', '1')
      }
    }
    aplicar()
    observador = new MutationObserver(aplicar)
    observador.observe(document.body, {
      childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'],
    })

    // Captura: pega o clique antes do handler do Vue, que não faria nada.
    document.addEventListener('click', function (ev) {
      if (!avisoEl) return
      var btn = ev.target && ev.target.closest && ev.target.closest('button')
      if (!btn || !ehBotaoDiscar(btn)) return
      ev.preventDefault()
      ev.stopPropagation()
      avisarBloqueio()
    }, true)
  }

  /** Chama a atenção para o banner e avisa o integrador. */
  function avisarBloqueio() {
    if (!avisoEl) return
    avisoEl.querySelector('.bp-aviso-txt').textContent = TXT_BLOQUEIO
    avisoEl.classList.remove('chamando')
    void avisoEl.offsetWidth
    avisoEl.classList.add('chamando')
    clearTimeout(avisoTimer)
    avisoTimer = setTimeout(function () {
      if (avisoEl) avisoEl.querySelector('.bp-aviso-txt').textContent = TXT_SEM_RAMAL
    }, 4000)
    bridge.emit('call:blocked', { reason: 'no_extension_assigned' })
  }

  /** Aplica o extensionStatus vindo do login ou do polling. */
  function aplicarStatusRamal(st) {
    if (!st) return
    // hasExtension=true com credentials_not_available significa "siga com o
    // que você tem": a credencial SIP vive só na memória do servidor e some
    // num restart. Tratar como "sem ramal" derrubaria um webphone que está
    // funcionando.
    if (st.hasExtension) {
      if (st.reason === 'relogin_required') {
        mostrarAvisoSemRamal(textoSeguro(st.message, TXT_RELOGIN))
      } else {
        esconderAvisoSemRamal()
      }
      return
    }
    mostrarAvisoSemRamal(textoSeguro(st.message, TXT_SEM_RAMAL))
  }

  // --- o estado real manda ----------------------------------------------------
  //
  // O usuário pode entrar ou sair pela tela do próprio webphone, sem o SDK
  // saber — e o banner ficava preso ao último estado informado: continuava
  // após o logout, e aparecia depois de um login com ramal. Observar o store
  // resolve os dois casos de uma vez, porque ali está a verdade.
  function vigiarEstadoDoApp() {
    waitFor(findStore, 30000).then(function (store) {
      var anterior = null
      var avaliar = function () {
        var st = store.state || {}
        var ext = st.extension
        var temRamal = !!(ext && ext.username && ext.password)
        var chave = (st.isLogged ? '1' : '0') + (temRamal ? '1' : '0')
        if (chave === anterior) return
        anterior = chave

        // Deslogado: nenhum aviso faz sentido, a tela é a de login.
        if (!st.isLogged) return esconderAvisoSemRamal()
        if (temRamal) return esconderAvisoSemRamal()
        mostrarAvisoSemRamal(TXT_SEM_RAMAL)
      }
      if (typeof store.subscribe === 'function') store.subscribe(avaliar)
      setInterval(avaliar, 1000)
      avaliar()
    }).catch(function () { /* sem store, o banner segue o que o SDK mandar */ })
  }
  vigiarEstadoDoApp()

  window.__bpSemRamal = function () { return !!avisoEl }


  // --- digitar pelo teclado --------------------------------------------------
  //
  // O bundle TEM um listener de teclado, mas ele é registrado numa condição
  // que não se cumpre aqui:
  //
  //     this.extension && true !== this.extension.external && (
  //       ..., this.addListenerToKeyboard(), ... )
  //
  // Sem ramal não há `extension`, então o listener nunca existe e digitar não
  // faz nada — só as teclas na tela funcionam.
  //
  // POR QUE POR CLIQUE, E NÃO PELO EMITTER: o emitter é uma variável de
  // módulo devolvida pelo `setup()`, e esta é uma build de PRODUÇÃO do Vue —
  // `app._instance` e `__vueParentComponent` não existem, então não há
  // caminho de API até ele. Medido: `tem_instance: false`, `elementos com
  // __vueParentComponent: 0`, `globalProperties: ['$store']`.
  //
  // Clicar no botão correspondente usa o mesmo caminho que já funciona para o
  // usuário, sem depender de nada interno.
  var TEC = '[bp-tecla]'

  /** Acha o botão do teclado numérico que corresponde à tecla. */
  function botaoDaTecla(k) {
    var pad = document.querySelector('.keypad')
    if (!pad) return null
    var btns = pad.querySelectorAll('button')
    for (var i = 0; i < btns.length; i++) {
      // O botão mostra o dígito e, às vezes, as letras ("2ABC"). O primeiro
      // caractere é o que importa.
      var txt = (btns[i].textContent || '').trim()
      if (txt && txt.charAt(0) === k) return btns[i]
    }
    return null
  }

  /** Acha o botão de ação pelo título, que vem do i18n. */
  function botaoPorTitulo(chaveI18n, alternativa) {
    var alvo = (chrome.i18n.getMessage(chaveI18n) || alternativa || '').toLowerCase()
    if (!alvo) return null
    var btns = document.querySelectorAll('button[title]')
    for (var i = 0; i < btns.length; i++) {
      if ((btns[i].getAttribute('title') || '').toLowerCase().indexOf(alvo) >= 0) {
        return btns[i]
      }
    }
    return null
  }

  function ligarTeclado() {
    var TECLAS = '0123456789*#+'

    function editandoOutraCoisa(alvo) {
      if (!alvo) return false
      var tag = (alvo.tagName || '').toLowerCase()
      return tag === 'input' || tag === 'textarea' || tag === 'select' ||
        alvo.isContentEditable === true
    }

    document.addEventListener('keydown', function (ev) {
      // O campo do bravophone-input.js assume a digitacao quando esta montado:
      // ele tem cursor, selecao e edicao no meio, coisas que clicar no botao
      // do dialpad nao consegue oferecer. Aqui so seguimos existindo para as
      // telas onde aquele campo nao aparece.
      if (window.__bpInputCampo && window.__bpInputCampo()) return

      var st = findStore()
      // COM ramal o bundle registra o proprio listener:
      //     this.extension && ... this.addListenerToKeyboard() ...
      // Insistir aqui faz cada tecla entrar duas vezes. Este atalho existe
      // exatamente para o caso contrario - sem ramal o bundle nao registra
      // nada e o teclado fica morto.
      if (st && st.state && st.state.extension) return

      if (ev.ctrlKey || ev.metaKey || ev.altKey) return
      if (editandoOutraCoisa(ev.target)) return

      // Só na aba do teclado: digitar no histórico não deve montar um número
      // invisível na outra tela.
      var aba = st && st.state ? st.state.currentTab : null
      if (aba && aba !== 'keypad') return

      var k = ev.key

      if (TECLAS.indexOf(k) >= 0 && k.length === 1) {
        var btn = botaoDaTecla(k)
        if (!btn) return   // teclado ainda n\u00e3o renderizou: deixa passar
        ev.preventDefault()
        btn.click()
        return
      }

      if (k === 'Backspace') {
        var apagar = botaoPorTitulo('webphoneDialBackspace', 'apagar')
        if (apagar) { ev.preventDefault(); apagar.click() }
        return
      }

      if (k === 'Enter') {
        ev.preventDefault()
        // Sem ramal o clique é interceptado e vira o aviso; com ramal, disca.
        var ligar = botaoPorTitulo('webphoneCallMake', 'ligar')
        if (ligar) ligar.click()
        return
      }

      if (k === 'Escape') {
        var limpar = botaoPorTitulo('webphoneDialClear', 'limpar')
        if (limpar) { ev.preventDefault(); limpar.click() }
      }
    }, true)   // captura: chega antes do handler do app, quando ele existe

    console.log(TEC, 'teclado ligado (por clique nos botoes do dialpad)')
  }

  // Não espera pelo emitter: ele não é alcançável em build de produção. O que
  // precisa existir é o DOM do teclado, que aparece junto com a tela.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ligarTeclado)
  } else {
    ligarTeclado()
  }

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
