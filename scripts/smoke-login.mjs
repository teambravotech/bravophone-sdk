// Verifica o caminho oposto ao da auto-autenticação: o login feito pela
// pessoa, com o e-mail já preenchido (`init({ email })`).
//
// Três coisas podem quebrar em silêncio aqui, e todas doem longe da causa:
//
//   1. a CHAVE. O bundle lê `bravophoneRememberEmail` do chrome.storage.sync,
//      que o shim mapeia para 'bp.sync.'. Gravar em 'bp.local.' (onde a sessão
//      mora) não faz nada — a tela sobe vazia e ninguém sabe por quê;
//   2. a SESSÃO. Com sessão injetada não há tela de login, e regravar o e-mail
//      lembrado faz o gerenciador de contas batizar a sessão com um endereço
//      de fora;
//   3. o FORMATO. Um endereço torto é recusado em silêncio pelo gerenciador de
//      contas (`registrarAtiva` exige o `@`): a conta nunca aparece na lista.

import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { buildSrcdoc } = await import('../src/srcdoc.js')
const { normalizarEmail } = await import('../src/login.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

/** Onde o bundle procura o e-mail lembrado, via shim. */
const CHAVE = 'bp.sync.bravophoneRememberEmail'
const EMAIL = 'ana.souza@empresa.com.br'

/** Roda o script embutido do srcdoc sobre um localStorage de mentira. */
function rodarSrcdoc(opts, inicial = {}) {
  const store = new Map(Object.entries(inicial))
  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const html = buildSrcdoc({ version: '0.0.0', parentOrigin: 'https://x.com', ...opts })
  const script = html.match(/<script>([\s\S]*?)<\\?\/script>/)[1]
  const window = { addEventListener: () => {} }
  vm.runInNewContext(script, {
    window,
    document: { querySelector: () => null, activeElement: null, hasFocus: () => false },
    localStorage,
    // O relógio do foco não roda aqui: o que este teste verifica é o storage.
    setTimeout: () => 0,
    Date, Number, JSON,
  })
  return { store, html, window }
}

console.log('\nemail — a tela de login sobe preenchida:')
{
  const { store, html, window } = rodarSrcdoc({ email: EMAIL })
  check('grava onde o bundle lê (bp.sync.)', store.get(CHAVE) === JSON.stringify(EMAIL),
    store.get(CHAVE))
  check('não grava em bp.local. (onde a sessão mora)',
    ![...store.keys()].some((k) => k.startsWith('bp.local.')))
  check('o e-mail viaja no cfg', /"email":"ana\.souza@empresa\.com\.br"/.test(html))
  check('cfg.session vem null', /"session":null/.test(html))
  // Sem sessão o gerenciador de contas fica DE PÉ: é ele quem lembra as
  // contas deste aparelho e troca entre elas sem pedir senha de novo.
  check('a troca de contas NÃO é desligada', window.__bpContasDesligadas !== true)
}

console.log('\nemail — sem e-mail, nada muda:')
{
  const { store, html } = rodarSrcdoc({})
  check('não toca no storage', store.size === 0)
  check('cfg.email vem null', /"email":null/.test(html))
}

console.log('\nemail — sessão injetada manda:')
{
  // A identidade é do integrador: não há tela de login para preparar, e o
  // gerenciador de contas está desligado.
  const { store, html, window } = rodarSrcdoc({ email: EMAIL, session: { vxToken: 'vx-1' } })
  check('com session, o e-mail é ignorado', !store.has(CHAVE), store.get(CHAVE))
  check('e nem entra no HTML', !html.includes('ana.souza'))
  check('a troca de contas é desligada', window.__bpContasDesligadas === true)
}

console.log('\nemail — quem já está logado neste navegador não é renomeado:')
{
  // O gerenciador de contas usa essa chave para batizar a sessão que encontra
  // (conciliar/registrarAtiva). Sobrescrever colocaria a conta na lista com o
  // e-mail de outra pessoa — e não há tela de login para preparar, de todo modo.
  const { store } = rodarSrcdoc({ email: EMAIL }, {
    'bp.local.bravophoneVxToken': '"vx-de-quem-ja-entrou"',
    [CHAVE]: '"joao@empresa.com.br"',
  })
  check('mantém o e-mail lembrado de quem já tem sessão',
    store.get(CHAVE) === '"joao@empresa.com.br"', store.get(CHAVE))
}

console.log('\nemail — formato: o que o gerenciador de contas aceita:')
{
  check('normaliza caixa e espaços',
    normalizarEmail('  Ana.Souza@Empresa.com.BR ') === 'ana.souza@empresa.com.br')
  const silencioso = (v) => {
    const antes = console.warn
    console.warn = () => {}
    try { return normalizarEmail(v) } finally { console.warn = antes }
  }
  for (const torto of ['ana', 'ana@local', '@empresa.com', 'ana souza@e.com', 'ana@@e.com']) {
    check(`recusa ${JSON.stringify(torto)}`, silencioso(torto) === null)
  }
  for (const vazio of [undefined, null, '']) {
    check(`ignora ${JSON.stringify(vazio)} sem reclamar`, normalizarEmail(vazio) === null)
  }
  check('o gerenciador de contas exige o mesmo @',
    (await readFile(join(ROOT, 'host/js/bravophone-contas.js'), 'utf8'))
      .includes("e.indexOf('@') < 0"))
}

console.log('\nemail — o widget só prepara o login quando não há sessão:')
{
  const widget = await readFile(join(ROOT, 'src/widget.js'), 'utf8')
  check('o e-mail passa pelo normalizador',
    /const emailDeLogin = sessaoAtual \? null : normalizarEmail\(email\)/.test(widget))
  check('e o modo hospedado avisa em vez de fingir',
    /if \(emailDeLogin\) \{\s*\n\s*console\.warn\(/.test(widget))
  check('o e-mail não vai para a URL do iframe hospedado',
    !/buildSrc\(new URL\(hostUrl\), \{[^}]*email/.test(widget))
}

console.log('\nemail — a fonte da verdade: o bundle e o shim:')
{
  const popup = join(ROOT, 'host/popup.js')
  if (!existsSync(popup)) {
    console.log('  · host/popup.js ausente (rode `npm run sync`) — pulando')
  } else {
    const js = await readFile(popup, 'utf8')
    check('o bundle lê bravophoneRememberEmail do storage.sync',
      /chrome\.storage\.sync\.get\("bravophoneRememberEmail"/.test(js))
    check('e o preenchimento ainda é o do mounted (checkRememberEmail)',
      js.includes('checkRememberEmail()'))
    // Se o bundle passar a focar a senha por conta própria, o remendo de foco
    // do srcdoc pode sair.
    check('o bundle ainda foca o e-mail por último (daí o remendo do foco)',
      /checkRememberEmail\(\),this\.\$refs\.email&&this\.\$refs\.email\.focus\(\)/.test(js))
  }

  const shim = await readFile(join(ROOT, 'host/shim/chrome-shim.js'), 'utf8')
  check("o shim mapeia storage.sync para 'bp.sync.'",
    /var PREFIX = 'bp\.'/.test(shim) && /sync: makeArea\('sync'\)/.test(shim) &&
    /var ns = PREFIX \+ area \+ '\.'/.test(shim))

  const contas = await readFile(join(ROOT, 'host/js/bravophone-contas.js'), 'utf8')
  check('o gerenciador de contas registra a conta por essa chave',
    contas.includes("ler(sync(), 'bravophoneRememberEmail')"))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
