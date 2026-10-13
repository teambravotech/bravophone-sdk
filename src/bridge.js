// Canal postMessage entre a página do cliente (host) e o iframe do webphone (guest).
//
// Regras de segurança, ambas obrigatórias:
//  - todo envio usa targetOrigin explícito (nunca '*');
//  - todo recebimento valida event.origin E event.source antes de olhar o payload.
// Sem isso qualquer iframe/aba da página consegue forjar eventos de chamada.

import { postar } from './clonavel.js'

const PROTOCOL = 'bravophone/v1'

export function createBridge({ frame, origin, onEvent }) {
  const pending = new Map()
  let seq = 0
  let ready = false
  const queue = []

  const onMessage = (ev) => {
    if (ev.origin !== origin) return
    if (ev.source !== frame.contentWindow) return
    const msg = ev.data
    if (!msg || msg.protocol !== PROTOCOL) return

    if (msg.type === 'ready') {
      ready = true
      while (queue.length) queue.shift()()
      onEvent?.('ready', msg.payload ?? {})
      return
    }

    if (msg.type === 'reply') {
      const entry = pending.get(msg.id)
      if (!entry) return
      pending.delete(msg.id)
      clearTimeout(entry.timer)
      msg.error ? entry.reject(new Error(msg.error)) : entry.resolve(msg.payload)
      return
    }

    if (msg.type === 'event') onEvent?.(msg.name, msg.payload)
  }

  window.addEventListener('message', onMessage)

  /** Dispara um comando e resolve com a resposta do guest. */
  function call(command, payload, { timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const id = `${Date.now()}-${++seq}`
      const send = () => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`BCVoz: timeout no comando "${command}"`))
        }, timeout)
        pending.set(id, { resolve, reject, timer })
        // O payload vem do integrador: `session` e `meta` podem chegar como
        // objeto reativo do framework dele (Proxy não é clonável) ou com um nó
        // do DOM pendurado. O postar sanea e tenta de novo.
        //
        // E se nem assim sair, rejeita AGORA. Antes a mensagem morria calada e
        // a promessa ficava pendurada até o timeout: 15 s para dizer o que já
        // se sabia na hora do envio — era o "timeout no comando" que o
        // integrador via sem nenhuma pista da causa.
        const saiu = postar(
          frame.contentWindow,
          { protocol: PROTOCOL, type: 'command', id, command, payload },
          origin,
        )
        if (!saiu) {
          clearTimeout(timer)
          pending.delete(id)
          reject(new Error(`BCVoz: o comando "${command}" não pôde ser enviado ao webphone`))
        }
      }
      ready ? send() : queue.push(send)
    })
  }

  return {
    call,
    get ready() { return ready },
    destroy() {
      window.removeEventListener('message', onMessage)
      pending.forEach(({ reject, timer }) => {
        clearTimeout(timer)
        reject(new Error('BCVoz: widget destruído'))
      })
      pending.clear()
    },
  }
}

export { PROTOCOL }
