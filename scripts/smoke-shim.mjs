// Smoke test do chrome-shim num DOM mínimo simulado, sem dependências.
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const store = new Map()
const localStorage = {
  get length() { return store.size },
  key: (i) => [...store.keys()][i] ?? null,
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
}

const win = {
  localStorage,
  document: { baseURI: 'https://webphone.bravophone.com/embed/', hasFocus: () => true },
  location: { href: 'https://webphone.bravophone.com/embed/' },
  navigator: { language: 'pt-BR' },
  __bpMessages: {
    SIMPLES: { message: 'Ligação rejeitada' },
    COM_SUB: { message: 'Chamada de $1 para $2' },
    NOMEADO: { message: 'Olá $USER$', placeholders: { USER: { content: 'Leonardo' } } },
    CIFRAO: { message: 'Custo: $$5' },
    VAZIO: { message: '' },
  },
  __bpLocale: 'pt-BR',
  innerWidth: 380, innerHeight: 640,
  console,
  URL, Promise, Object, Array, Date, String, JSON, setTimeout,
}
win.window = win
vm.createContext(win)
vm.runInContext(readFileSync('host/shim/chrome-shim.js', 'utf8'), win)

const chrome = win.chrome
let pass = 0, fail = 0
const check = (name, cond) => {
  cond ? (pass++, console.log(`  ✓ ${name}`)) : (fail++, console.log(`  ✗ ${name}`))
}

console.log('chrome-shim:')
check('shim ativou', win.__bpShimActive === true)

// set/get com callback (o estilo que popup.js usa)
let got
chrome.storage.sync.set({ vxToken: 'abc123' }, () => {
  chrome.storage.sync.get('vxToken', (r) => { got = r })
})
check('storage.sync set→get (callback)', got?.vxToken === 'abc123')

// get com objeto de defaults
let withDefault
chrome.storage.sync.get({ vxToken: 'x', naoExiste: 'padrao' }, (r) => { withDefault = r })
check('get aplica defaults', withDefault.vxToken === 'abc123' && withDefault.naoExiste === 'padrao')

// get com array
let arr
chrome.storage.sync.get(['vxToken'], (r) => { arr = r })
check('get com array', arr.vxToken === 'abc123')

// tipos não-string sobrevivem ao round-trip
let obj
chrome.storage.local.set({ cfg: { volume: 0.8, on: true } }, () => {
  chrome.storage.local.get('cfg', (r) => { obj = r })
})
check('preserva objeto/boolean/number', obj.cfg.volume === 0.8 && obj.cfg.on === true)

// áreas são isoladas
let iso
chrome.storage.local.get('vxToken', (r) => { iso = r })
check('sync e local isolados', iso.vxToken === undefined)

// onChanged dispara com old/new
let change = null
chrome.storage.onChanged.addListener((c, area) => { change = { c, area } })
chrome.storage.sync.set({ vxToken: 'novo' })
check('onChanged dispara', change?.c?.vxToken?.newValue === 'novo')
check('onChanged traz oldValue', change?.c?.vxToken?.oldValue === 'abc123')
check('onChanged traz a área', change?.area === 'sync')

// hasListener / removeListener (usados pelo ContactDialer)
const fn = () => {}
chrome.runtime.onMessage.addListener(fn)
check('onMessage.hasListener', chrome.runtime.onMessage.hasListener(fn) === true)
chrome.runtime.onMessage.removeListener(fn)
check('onMessage.removeListener', chrome.runtime.onMessage.hasListener(fn) === false)

// sendMessage entrega ao listener e devolve resposta
let recebido = null, resposta = null
chrome.runtime.onMessage.addListener((msg, _s, reply) => { recebido = msg; reply({ ok: 1 }) })
chrome.runtime.sendMessage({ method: 'bravophoneSuccessIntegrationCall' }, (r) => { resposta = r })
check('sendMessage entrega', recebido?.method === 'bravophoneSuccessIntegrationCall')
check('sendMessage responde', resposta?.ok === 1)

// remove
let apos
chrome.storage.sync.remove('vxToken', () => {
  chrome.storage.sync.get('vxToken', (r) => { apos = r })
})
check('remove apaga a chave', apos.vxToken === undefined)

// getURL resolve relativo ao host
check('runtime.getURL', chrome.runtime.getURL('images/logo.png')
  === 'https://webphone.bravophone.com/embed/images/logo.png')

// windows.getCurrent com callback na 1ª posição (assinatura usada no popup.js)
let w
chrome.windows.getCurrent({}, (r) => { w = r })
check('windows.getCurrent(obj, cb)', w?.id === 1)
chrome.windows.getCurrent((r) => { w = r })
check('windows.getCurrent(cb)', w?.id === 1)

// lastError precisa existir e ser undefined (o bundle testa isso em guardas)
check('runtime.lastError undefined', 'lastError' in chrome.runtime && chrome.runtime.lastError === undefined)


// --- i18n: de onde vem praticamente todo label da interface ---
check('getMessage devolve a mensagem', chrome.i18n.getMessage('SIMPLES') === 'Ligação rejeitada')
check('chave inexistente devolve string vazia', chrome.i18n.getMessage('NAO_EXISTE') === '')
check('substituições posicionais',
  chrome.i18n.getMessage('COM_SUB', ['Ana', 'Bia']) === 'Chamada de Ana para Bia')
check('substituição única sem array',
  chrome.i18n.getMessage('COM_SUB', 'Ana') === 'Chamada de Ana para ')
check('placeholder nomeado', chrome.i18n.getMessage('NOMEADO') === 'Olá Leonardo')
check('$$ vira cifrão literal', chrome.i18n.getMessage('CIFRAO') === 'Custo: $5')
check('mensagem vazia continua vazia', chrome.i18n.getMessage('VAZIO') === '')
check('getUILanguage usa o locale carregado', chrome.i18n.getUILanguage() === 'pt-BR')

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
