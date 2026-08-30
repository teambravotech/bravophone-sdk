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

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
