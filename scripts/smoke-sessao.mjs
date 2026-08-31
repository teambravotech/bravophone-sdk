// Verifica que a sessão é gravada exatamente onde o bundle a procura.
//
// Existe por causa de um bug real: o SDK gravava `vxToken`, e o bundle lê
// `bravophoneVxToken`. Nenhum dos dois lados conhecia a chave do outro, então
// a auto-autenticação nunca funcionou — o RouteSelector avisava "faça login
// pelo webphone", que é justamente o que ela existe para evitar.
//
// As chaves saem do bpSaveSession do popup.js. Se ele mudar, este teste falha
// antes do usuário descobrir.

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { buildSrcdoc } = await import('../src/srcdoc.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

/** Nomes exatos que o bpSaveSession do bundle grava. */
const CHAVES = [
  'bravophoneVxToken', 'bravophoneVxTokenExpiresAt', 'bravophoneSip',
  'bravophoneTenant', 'bravophoneRamal', 'bravophoneClienteId',
  'bravophoneRamaisUrl',
]

const SESSAO = {
  vxToken: 'vx-abc', expiresIn: 3600, sip: 'sip.exemplo.com',
  tenant: 'acme', ramal: '1001', clienteId: '42',
  ramaisUrl: 'https://pabx.teambravotech.com/api/ramais',
}

console.log('\nsessão — o srcdoc grava onde o bundle lê:')
{
  const html = buildSrcdoc({ version: '0.0.0', parentOrigin: 'https://x.com', session: SESSAO })
  for (const k of CHAVES) check(`grava ${k}`, html.includes(k))
  // O prefixo é como o chrome-shim mapeia chrome.storage.local: sem ele, o
  // bundle não enxerga nada do que foi gravado.
  check("usa o prefixo 'bp.local.'", html.includes("'bp.local.' + k"))
  check('não grava a chave errada (vxToken solto)',
    !/localStorage\.setItem\('bp\.local\.vxToken'/.test(html))
}

console.log('\nsessão — sem sessão não grava nada:')
{
  const html = buildSrcdoc({ version: '0.0.0', parentOrigin: 'https://x.com' })
  check('cfg.session vem null', /"session":null/.test(html))
}

console.log('\nsessão — o guest-bridge usa as mesmas chaves:')
{
  const bridge = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')
  for (const k of CHAVES) check(`auth grava ${k}`, bridge.includes(k))
  check('logout remove as mesmas chaves',
    /CHAVES\s*=\s*\[[^\]]*bravophoneVxToken/.test(bridge))
  check('não grava a chave antiga',
    !/storage\.local\.set\(\{\s*vxToken/.test(bridge))
}

console.log('\nsessão — o bundle do host realmente lê estas chaves:')
{
  // Confere contra a fonte da verdade: se o popup.js mudar os nomes, este
  // teste acusa em vez de deixar a integração quebrar em silêncio.
  const popup = join(ROOT, 'host/popup.js')
  if (!existsSync(popup)) {
    console.log('  · host/popup.js ausente (rode `npm run sync`) — pulando')
  } else {
    const js = await readFile(popup, 'utf8')
    for (const k of CHAVES) check(`popup.js referencia ${k}`, js.includes(k))
    const rs = join(ROOT, 'host/js/bravophone-route-selector.js')
    if (existsSync(rs)) {
      check('o RouteSelector lê bravophoneVxToken',
        (await readFile(rs, 'utf8')).includes('bravophoneVxToken'))
    }
  }
}

console.log('\nramal SIP — a segunda metade que o checkToken exige:')
{
  // Estar logado exige DUAS coisas: o vxToken da sessão e um `extension` com
  // username e password. Só a sessão deixa o app na tela de login, e a
  // mensagem que aparece manda "fazer login pelo webphone" — justamente o que
  // a auto-autenticação existe para evitar.
  const bridge = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')
  check('auth aplica o extension no store', /commit\('addExtension'/.test(bridge))
  check('aplica DEPOIS de gravar a sessão',
    bridge.indexOf('storage.local.set(dados') < bridge.indexOf("commit('addExtension'"))

  // A credencial SIP no HTML do srcdoc ficaria legível no DOM da página do
  // integrador. Ela viaja só por postMessage.
  const html = buildSrcdoc({
    version: '0', parentOrigin: 'https://x.com',
    session: { ...SESSAO, extension: { username: 'u', password: 'SENHA-SIP' } },
  })
  check('a senha SIP não entra no HTML do srcdoc', !html.includes('SENHA-SIP'))
  check('a sessão do proxy continua pré-gravada', html.includes('bravophoneVxToken'))

  const popup = join(ROOT, 'host/popup.js')
  if (existsSync(popup)) {
    const js = await readFile(popup, 'utf8')
    // Se o bundle deixar de exigir as duas metades, este teste avisa que a
    // complexidade aqui pode ser removida.
    check('o bundle ainda exige extension.username e .password',
      js.includes('!this.extension.password') || js.includes('!e.password'))
  }
}

console.log('\nramal — a ausência de credencial não é prova de ausência de ramal:')
{
  // A dedução antiga acusava "nenhum ramal atribuído" para quem TEM ramal:
  // o integrador pode não ter as credenciais SIP em mãos, e no modo srcdoc
  // elas são removidas do payload de propósito. Só a API sabe.
  const ponte = await readFile(join(ROOT, 'host/shim/guest-bridge.js'), 'utf8')

  check('não deduz mais pela presença do extension',
    !/hasExtension: !!s\.extension/.test(ponte))
  check('o extensionStatus do login continua sendo obedecido',
    /if \(s\.extensionStatus\) aplicarStatusRamal\(s\.extensionStatus\)/.test(ponte))
  // A evidência é assimétrica: extension presente PROVA que há ramal.
  check('e extension presente esconde o aviso',
    /else if \(s\.extension\) esconderAvisoSemRamal\(\)/.test(ponte))

  // Ficar calado só é seguro porque alguém vai perguntar: sem apiBase não
  // havia consulta nenhuma, e o estado ficava o do login para sempre.
  const widget = await readFile(join(ROOT, 'src/widget.js'), 'utf8')
  check('apiBase tem padrão de produção',
    /apiBase = 'https:\/\/pabx\.teambravotech\.com'/.test(widget))

  const ramal = await readFile(join(ROOT, 'src/ramal.js'), 'utf8')
  check('e a primeira consulta é imediata, não no próximo ciclo',
    /\n  consultar\(\)\n  agendar\(\)/.test(ramal))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
