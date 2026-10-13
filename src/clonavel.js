// Clonagem estruturada: o que o postMessage aceita, e o que fazer quando ele recusa.
//
// POR QUE EXISTE: o canal entre o host e o iframe copia tudo pelo algoritmo de
// clonagem estruturada do navegador, e ele NÃO aceita tudo. Ficam de fora
// função, nó do DOM, MediaStream, RTCPeerConnection, a sessão SIP crua — e
// qualquer Proxy, que é o que todo estado reativo (Vue, Svelte) devolve. Um
// único campo desses lança DataCloneError e a mensagem INTEIRA se perde, calada:
// quem esperava resposta fica no timeout de 15 s e quem esperava evento nunca é
// avisado. Foi assim que o `getStatus()` de um integrador Vue parou de responder.
//
// Então nenhum lado do canal confia no payload: tenta mandar como veio (caminho
// normal, custo zero) e, se o navegador recusar, remonta uma cópia só com o que
// atravessa e manda de novo. Perder campos é ruim; perder a mensagem é pior.
//
// O gêmeo deste arquivo mora no `sanear`/`post` de host/shim/guest-bridge.js —
// lado iframe, script solto que não pode importar daqui. Mudança aqui pede a
// mesma mudança lá.

// Profundidade máxima da remontagem. Payload mais fundo que isto não é dado de
// telefonia: é uma estrutura inteira que vazou para a ponte por engano.
const NIVEL_MAX = 8

/** Uma cópia do valor contendo só o que a clonagem estruturada aceita. */
export function sanear(valor) {
  return limpar(valor, [], 0)
}

function limpar(valor, vistos, nivel) {
  if (valor === null || valor === undefined) return valor

  const tipo = typeof valor
  if (tipo === 'string' || tipo === 'number' || tipo === 'boolean' || tipo === 'bigint') {
    return valor
  }
  // Função e símbolo nunca atravessam, e não há cópia possível deles.
  if (tipo !== 'object') return undefined

  if (nivel > NIVEL_MAX) return undefined
  // Ciclo: o mesmo objeto reapareceu na própria descida. `vistos` guarda só o
  // caminho atual, então um objeto repetido em dois ramos continua indo.
  if (vistos.indexOf(valor) !== -1) return undefined

  // Data e Error são clonáveis e carregam informação útil — valem a cópia.
  if (valor instanceof Date) {
    return Number.isNaN(valor.getTime()) ? null : new Date(valor.getTime())
  }
  if (valor instanceof Error) {
    return { name: String(valor.name || 'Error'), message: String(valor.message || '') }
  }

  // A FORMA decide, não o nome da classe: '[object Object]' e '[object Array]'
  // são dado e seguem como dado. Qualquer outra etiqueta (HTMLDivElement,
  // MediaStream, RTCPeerConnection, Window, Map...) é objeto de plataforma, e
  // aqui ele sai de cena. Um Proxy do Vue sobre dado simples se declara
  // '[object Object]' e por isso é remontado em objeto comum — que é o ponto.
  const etiqueta = Object.prototype.toString.call(valor)
  const lista = etiqueta === '[object Array]'
  if (!lista && etiqueta !== '[object Object]') return undefined

  vistos.push(valor)
  try {
    if (lista) {
      const saida = []
      for (let i = 0; i < valor.length; i++) saida.push(ler(valor, i, vistos, nivel))
      return saida
    }
    const saida = {}
    for (const chave of Object.keys(valor)) {
      const v = ler(valor, chave, vistos, nivel)
      if (v !== undefined) saida[chave] = v
    }
    return saida
  } finally {
    vistos.pop()
  }
}

// Ler uma propriedade pode EXECUTAR código: getter do bundle, computed do Vue,
// acessor que depende de uma conexão já fechada. Se estourar, o campo sai de
// cena em vez de derrubar a mensagem toda.
function ler(obj, chave, vistos, nivel) {
  let v
  try { v = obj[chave] } catch { return undefined }
  return limpar(v, vistos, nivel + 1)
}

/** Se a recusa foi da clonagem — o único caso que sanear conserta. */
export function recusaDeClonagem(err) {
  if (!err) return true
  if (err.name === 'DataCloneError') return true
  return /could not be cloned|n[ãa]o p[ôo]de ser clonad/i.test(String(err.message || ''))
}

/**
 * Envia pelo canal e devolve se a mensagem SAIU.
 *
 * Devolver isso não é detalhe: quem responde a um comando precisa saber, ou o
 * outro lado espera o timeout inteiro por uma resposta que nunca foi enviada.
 */
export function postar(alvo, msg, origem) {
  if (!alvo || typeof alvo.postMessage !== 'function') return false

  try {
    alvo.postMessage(msg, origem)
    return true
  } catch (err) {
    // Origem errada (SecurityError) é configuração: tentar de novo não muda
    // nada, e sanear esconderia a causa real atrás de um aviso errado.
    if (!recusaDeClonagem(err)) {
      console.error('BCVoz: postMessage falhou:', err)
      return false
    }
  }

  try {
    alvo.postMessage(sanear(msg), origem)
    console.warn('BCVoz: payload não clonável em "' + rotulo(msg) +
      '" — os campos não serializáveis foram descartados.')
    return true
  } catch (err) {
    console.error('BCVoz: postMessage falhou mesmo depois de sanear:', err)
    return false
  }
}

function rotulo(msg) {
  return String((msg && (msg.command || msg.name || msg.type)) || 'mensagem')
}
