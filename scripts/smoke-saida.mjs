// Sair da página: quando o navegador pode perguntar, e quando o ramal cai.
//
// POR QUE ESTE ARQUIVO EXISTE: o bundle registrava, no instante em que o ramal
// registrava no SIP, um beforeunload que chamava `e.preventDefault()` SEMPRE:
//
//     window.addEventListener("beforeunload", function (e) {
//       return e.preventDefault(), …, t.getUserAgent().unregister(), !1
//     })
//
// O objetivo era só desregistrar o ramal ao fechar — e isso não precisa de
// preventDefault nenhum. O efeito colateral era "É possível que as alterações
// feitas não sejam salvas" em TODA saída de página, o dia inteiro, sem ligação
// em curso e sem nada editado. No modo srcdoc o listener vive dentro do iframe
// e o beforeunload de um iframe participa da navegação do documento de topo:
// o diálogo aparecia na aplicação inteira do integrador.
//
// O teste não olha só o texto do bundle: ele arranca os dois listeners do
// popup.js e os EXECUTA com um window e um componente falsos, porque o que
// importa é o comportamento — pergunta só com ligação em curso, desregistra
// sempre, e nunca derruba a saída.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = resolve(SDK, '..', 'Bravophone')
const BUNDLE = join(SDK, 'host', 'popup.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

// host/popup.js vem da extensão pelo `npm run sync` e é gitignorado: num clone
// novo ele ainda não existe. Falhar limpo é melhor que um ENOENT.
if (!existsSync(BUNDLE)) {
  console.log('\n✗ host/popup.js não existe — rode `npm run sync` antes.')
  process.exit(1)
}
const js = readFileSync(BUNDLE, 'utf8')

/**
 * Recorta os listeners de saída de dentro do bundle minificado.
 *
 * Começa no `const t=this.webphone` (o alias que o unregister usa) e termina
 * no `}else` que fecha o bloco de "tem credencial". É exatamente o trecho que
 * scripts/sync-from-extension.mjs reescreve a cada sync.
 */
function recortar() {
  const i = js.indexOf('const t=this.webphone;window.addEventListener(')
  if (i < 0) return null
  const j = js.indexOf('}else this.toast.error(', i)
  return j < 0 ? null : js.slice(i, j)
}

const codigo = recortar()

console.log('\no trecho de saída está onde o patch o deixou:')
{
  check('os listeners foram encontrados no bundle', !!codigo)
  // O sintoma exato que originou tudo isto.
  check('o beforeunload incondicional sumiu',
    !js.includes('"beforeunload",function(e){return e.preventDefault()'))
  // Varre TODO beforeunload do bundle, não só o nosso: o outro é o do RUM do
  // Datadog, que apenas notifica. Nenhum pode bloquear a saída sem motivo.
  const trechos = [...js.matchAll(/addEventListener\((?:window,)?"beforeunload"/g)]
    .map((m) => js.slice(m.index, m.index + 220))
  check('nenhum beforeunload do bundle bloqueia a saída sem checar ligação',
    trechos.every((t) => !t.includes('preventDefault') || t.includes('isRunningCall')),
    `${trechos.length} listeners`)
}

if (!codigo) {
  console.log('\nsem o trecho não há o que executar.')
  console.log(`\n${pass} passaram, ${fail} falharam`)
  process.exit(1)
}

/** Monta window e componente falsos e executa o trecho de verdade. */
function montar({ isRunningCall = false, isDebug = false, uaQuebrado = false } = {}) {
  const eventos = {}
  const janela = {
    addEventListener: (tipo, fn) => { (eventos[tipo] = eventos[tipo] || []).push(fn) },
  }
  const visto = { unregister: 0, logs: [] }
  const componente = {
    isRunningCall,
    isDebug,
    webphone: {
      getUserAgent: () => {
        // Aba fechando com a sessão já derrubada: acontece de verdade.
        if (uaQuebrado) throw new Error('user agent já foi embora')
        return { unregister: () => { visto.unregister++ } }
      },
    },
  }
  const consoleFalso = { info: (...a) => visto.logs.push(a.join(' ')) }
  new Function('window', 'console', codigo).call(componente, janela, consoleFalso)
  return { eventos, visto }
}

function disparar(eventos, tipo) {
  const e = { bloqueou: 0, returnValue: undefined, preventDefault() { this.bloqueou++ } }
  for (const fn of eventos[tipo] || []) fn(e)
  return e
}

console.log('\nsem ligação em curso, sair é sair:')
{
  const { eventos, visto } = montar({ isRunningCall: false })
  check('registra beforeunload e pagehide', !!eventos.beforeunload && !!eventos.pagehide,
    Object.keys(eventos).join(', '))

  const e = disparar(eventos, 'beforeunload')
  check('não chama preventDefault', e.bloqueou === 0)
  // O Chrome também abre o diálogo se returnValue for atribuído.
  check('não mexe em returnValue', e.returnValue === undefined, String(e.returnValue))
  check('e não desregistra no beforeunload (isso é do pagehide)', visto.unregister === 0)

  disparar(eventos, 'pagehide')
  check('o pagehide desregistra o ramal', visto.unregister === 1, visto.unregister)
}

console.log('\ncom ligação em curso, o navegador pergunta:')
{
  const { eventos, visto } = montar({ isRunningCall: true })
  const e = disparar(eventos, 'beforeunload')
  check('chama preventDefault', e.bloqueou === 1)
  check('e define returnValue, que é o que o Chrome exige', e.returnValue === '')

  // Confirmar não é o mesmo que ficar: se a pessoa sai, o ramal tem de cair.
  disparar(eventos, 'pagehide')
  check('sair mesmo assim ainda desregistra', visto.unregister === 1, visto.unregister)
}

console.log('\no unregister não atrapalha a saída:')
{
  const { eventos } = montar({ uaQuebrado: true })
  let explodiu = null
  try { disparar(eventos, 'pagehide') } catch (err) { explodiu = err.message }
  check('user agent morto não vaza exceção no pagehide', explodiu === null, explodiu)

  const e = disparar(eventos, 'pagehide')
  check('o pagehide nunca bloqueia a saída', e.bloqueou === 0)
}

console.log('\no log de debug voltou a existir:')
{
  // No original o handler era `function`, então `this` era o window e
  // `this.isDebug` era sempre undefined: aquele console.info nunca rodou.
  const ligado = montar({ isDebug: true })
  disparar(ligado.eventos, 'pagehide')
  check('com isDebug, o pagehide loga', ligado.visto.logs.length === 1,
    ligado.visto.logs.join(' | '))

  const quieto = montar({ isDebug: false })
  disparar(quieto.eventos, 'pagehide')
  check('sem isDebug, fica quieto', quieto.visto.logs.length === 0)
}

console.log('\na correção sobrevive ao próximo sync:')
{
  // host/popup.js é copiado da extensão a cada `npm run sync`. Sem o patch no
  // script, a correção some no sync seguinte e ninguém percebe até o cliente
  // reclamar do diálogo de novo.
  const sync = readFileSync(join(SDK, 'scripts', 'sync-from-extension.mjs'), 'utf8')
  check('o sync chama o patch de saída', /await corrigirSaidaDaPagina\(\)/.test(sync))
  check('e o patch não é opcional',
    !/if \([^)]*\) await corrigirSaidaDaPagina\(\)/.test(sync))

  if (existsSync(join(EXT, 'popup.js'))) {
    // Se a extensão mudar esse trecho, o sync falha alto — mas é melhor saber
    // aqui, antes de rodar o sync.
    const ext = readFileSync(join(EXT, 'popup.js'), 'utf8')
    check('o bundle da extensão ainda registra a saída onde o patch procura',
      /getUserAgent\(\)\.start\(\);const \w+=this\.webphone;window\.addEventListener\("beforeunload"/
        .test(ext))
  } else {
    console.log('  · extensão não encontrada, pulando a checagem cruzada')
  }
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
