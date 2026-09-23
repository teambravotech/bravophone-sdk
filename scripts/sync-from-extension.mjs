#!/usr/bin/env node
/**
 * sync-from-extension.mjs
 *
 * Copia os assets buildados da extensão para host/ e gera o host/index.html
 * com a ordem de carga correta.
 *
 * A extensão é a FONTE DA VERDADE do webphone: nada é editado aqui.
 * Rode este script sempre que a extensão for atualizada.
 *
 *   node scripts/sync-from-extension.mjs [caminho-da-extensao] [--public-path=/embed/]
 */
import { readFile, writeFile, mkdir, cp, rm, readdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const EXT = resolve(process.argv.find((a, i) => i >= 2 && !a.startsWith('--')) || join(ROOT, '..', 'Bravophone'))
const HOST = join(ROOT, 'host')

/**
 * Assets trazidos da extensão, copiados para a RAIZ de host/ — de propósito.
 *
 * O bundle foi buildado com `__webpack_public_path__ = "/"`, então ele resolve
 * `/fonts/Audiowide-Regular.ttf` e `/fonts/Seguiemj.ttf` a partir da raiz do
 * site. Servir os assets sob um subdiretório faz essas duas fontes darem 404 e
 * o navegador cair no fallback — a marca e os emojis mudam de aparência depois
 * do login, que é onde a Audiowide aparece.
 *
 * Replicar o layout de URL da extensão evita qualquer patch no bundle.
 * Consequência de deploy: o host precisa ficar na RAIZ de um domínio ou
 * subdomínio. Para servir sob um subpath, use --public-path=/embed/.
 *
 * Backups (.bak-*) ficam de fora.
 */
const ASSETS = [
  { from: 'popup.js', to: 'popup.js', required: true },
  { from: 'js/libwebphone.js', to: 'js/libwebphone.js', required: true },
  { from: 'js/bravophone-route-selector.js', to: 'js/bravophone-route-selector.js', required: true },
  { from: 'js/bravophone-noise-suppressor.js', to: 'js/bravophone-noise-suppressor.js', required: false },
  // Aviso de "sem ramal": vive na extensão e é reaproveitado pelo host.
  { from: 'js/bravophone-sem-ramal.js', to: 'js/bravophone-sem-ramal.js', required: false },
  // Botao de presenca: re-registra ou procura ramal, com giro honesto.
  { from: 'js/bravophone-reconectar.js', to: 'js/bravophone-reconectar.js', required: false },
  // Campo de discagem reformulado: vive na extensão e o host reaproveita.
  { from: 'js/bravophone-input.js', to: 'js/bravophone-input.js', required: false },
  { from: 'js/bravophone-presenca.js', to: 'js/bravophone-presenca.js', required: false },
  // Identidade do aparelho no REGISTER (X-Bravo-Device-*). Depende do
  // deviceId da presença — daí vir logo depois dela.
  { from: 'js/bravophone-aparelho.js', to: 'js/bravophone-aparelho.js', required: false },
  { from: 'js/bravophone-audio.js', to: 'js/bravophone-audio.js', required: false },
  // Qualidade de chamada lida do getStats() do WebRTC.
  { from: 'js/bravophone-qualidade.js', to: 'js/bravophone-qualidade.js', required: false },
  // Ringback local: cobre o silêncio entre o "chamando" (180 Ringing, sem
  // áudio) e a mídia adiantada do PABX. O silêncio é do protocolo SIP, não do
  // invólucro, então vale aqui igual. Depende do mesmo getStats() do
  // qualidade para saber quando o áudio real chegou — daí vir logo depois.
  { from: 'js/bravophone-ringback.js', to: 'js/bravophone-ringback.js', required: false },
  { from: 'js/bravophone-ping.js', to: 'js/bravophone-ping.js', required: false },
  { from: 'js/bravophone-qualidade-envio.js', to: 'js/bravophone-qualidade-envio.js', required: false },
  { from: 'js/bravophone-janela.js', to: 'js/bravophone-janela.js', required: false },
  // Tema claro/escuro: precisa rodar antes do primeiro quadro.
  { from: 'js/bravophone-tema.js', to: 'js/bravophone-tema.js', required: false },
  { from: 'js/noise', to: 'js/noise', required: false },
  { from: 'css', to: 'css', required: true },
  { from: 'images', to: 'images', required: false },
  { from: 'fonts', to: 'fonts', required: true },
  { from: 'favicon.ico', to: 'favicon.ico', required: false },
  // Obrigatório: sem ele a interface inteira fica sem textos (ver buildMessages).
  { from: '_locales', to: '_locales', required: true },
]

/** Assets que o bundle busca por caminho absoluto — verificados após a cópia. */
const MUST_RESOLVE = ['fonts/Audiowide-Regular.ttf', 'fonts/Seguiemj.ttf']

const skipBackups = (src) => !/\.bak-[\w-]+$/.test(src)

async function main() {
  let publicPath = (process.argv.find((a) => a.startsWith('--public-path=')) || '').split('=')[1]

  // --cdn: aponta os assets para o CDN desta mesma versão do pacote. É o que
  // permite o modo srcdoc — o iframe roda na origem do cliente, mas as fontes
  // e o resto vêm do jsDelivr, não da raiz do site dele.
  if (process.argv.includes('--cdn')) {
    const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'))
    publicPath = `https://cdn.jsdelivr.net/npm/${pkg.name}@${pkg.version}/host/`
  }

  if (!existsSync(EXT)) {
    console.error(`✗ Extensão não encontrada em: ${EXT}`)
    console.error('  Passe o caminho: node scripts/sync-from-extension.mjs <caminho>')
    process.exit(1)
  }

  console.log(`→ Origem: ${EXT}`)

  // Limpa só o que veio da extensão; shim/, mock* e allowed-origins.json ficam.
  for (const asset of ASSETS) {
    await rm(join(HOST, asset.to), { recursive: true, force: true })
  }

  let copied = 0
  for (const asset of ASSETS) {
    const src = join(EXT, asset.from)
    if (!existsSync(src)) {
      if (asset.required) {
        console.error(`✗ Asset obrigatório ausente: ${asset.from}`)
        process.exit(1)
      }
      console.log(`  · pulando ${asset.from} (não existe)`)
      continue
    }
    const dest = join(HOST, asset.to)
    await mkdir(dirname(dest), { recursive: true })
    await cp(src, dest, { recursive: true, filter: skipBackups })
    console.log(`  ✓ ${asset.from}`)
    copied++
  }

  // Falha alto se um asset de caminho absoluto não aterrissou onde o bundle
  // vai procurar — senão o sintoma só aparece como fonte errada em runtime.
  for (const rel of MUST_RESOLVE) {
    if (!existsSync(join(HOST, rel))) {
      console.error(`✗ ${rel} não está onde o bundle busca (/${rel}).`)
      process.exit(1)
    }
  }
  console.log('  ✓ fontes resolvem em /fonts/ (Audiowide, SegoeUIEmoji)')

  await buildMessages()

  await corrigirSaidaDaPagina()

  if (publicPath) await rewritePublicPath(publicPath)

  if (process.argv.includes('--sem-ramal')) await permitirLoginSemRamal()

  await writeFile(join(HOST, 'index.html'), buildHtml(), 'utf8')
  console.log('  ✓ host/index.html gerado')
  console.log(`\n✓ ${copied} assets sincronizados em host/`)
  console.log(publicPath
    ? `  public path reescrito para "${publicPath}" — publique host/ nesse subpath.`
    : '  Publique host/ na RAIZ de um domínio (ex.: https://webphone.bravophone.com/).')
}

/**
 * Gera host/shim/messages.js a partir de _locales/.
 *
 * O bundle expõe um método Vue `t(k){ return chrome.i18n.getMessage(k) }` e os
 * templates chamam isso para PRATICAMENTE TODO label da interface. Numa página
 * comum não existe chrome.i18n, então sem este arquivo os textos vêm vazios —
 * a UI aparece com as caixas e os ícones, mas sem palavra nenhuma.
 *
 * getMessage é síncrono, então as mensagens têm de estar disponíveis antes do
 * popup.js avaliar: por isso um .js embutido, e não um fetch.
 */
async function buildMessages() {
  const dir = join(HOST, '_locales')
  const out = join(HOST, 'shim', 'messages.js')

  if (!existsSync(dir)) {
    console.error('✗ _locales ausente: a interface ficaria sem textos.')
    process.exit(1)
  }

  const locales = {}
  for (const name of await readdir(dir)) {
    const file = join(dir, name, 'messages.json')
    if (!existsSync(file)) continue
    // messages.json da extensão vem com BOM; JSON.parse não aceita.
    const raw = (await readFile(file, 'utf8')).replace(/^﻿/, '')
    locales[name] = JSON.parse(raw)
  }

  const names = Object.keys(locales)
  if (!names.length) {
    console.error('✗ nenhum messages.json encontrado em _locales/.')
    process.exit(1)
  }

  const total = names.reduce((n, k) => n + Object.keys(locales[k]).length, 0)
  const js = `/* Gerado por scripts/sync-from-extension.mjs — não edite.
 * Fonte: _locales/ da extensão. Alimenta chrome.i18n.getMessage no shim.
 */
window.__bpLocales = ${JSON.stringify(locales)};
(function () {
  var want = (navigator.language || 'pt-BR').replace('-', '_');
  var have = Object.keys(window.__bpLocales);
  var pick = have.indexOf(want) !== -1 ? want
    : have.filter(function (l) { return l.split('_')[0] === want.split('_')[0] })[0]
    || have[0];
  window.__bpMessages = window.__bpLocales[pick];
  window.__bpLocale = pick.replace('_', '-');
})();
`
  await writeFile(out, js, 'utf8')
  console.log(`  ✓ shim/messages.js  (${names.join(', ')} · ${total} mensagens)`)
}

/**
 * Permite entrar sem ramal SIP atribuído.
 *
 * O bundle exige as duas metades para considerar o usuário logado:
 *
 *     const bpLogged = bpTemExt && !!s.vxToken
 *
 * Sem ramal, `bpTemExt` é falso e o app fica na tela de login — mesmo com a
 * sessão válida. Este patch faz o login depender só da sessão.
 *
 * É seguro porque o bundle já se protege: o `new libwebphone()` só acontece
 * dentro de `if (extension.username && extension.password)`, e os 16
 * handlers `webphone.on` vivem nesse mesmo bloco. Sem credencial o objeto
 * não é criado, `startUserAgent()` cai no `this.webphone && …` e nada tenta
 * registrar.
 *
 * O aviso "sem ramal" é responsabilidade do SDK, na moldura do widget.
 */
async function permitirLoginSemRamal() {
  const file = join(HOST, 'popup.js')
  const js = await readFile(file, 'utf8')
  const alvo = 'const bpLogged=bpTemExt&&!!s.vxToken'
  const jaAplicado = 'const bpLogged=!!s.vxToken'
  const n = js.split(alvo).length - 1

  // A extensão já pode trazer o patch de fábrica — é o caso desde que ele foi
  // aplicado lá. Nada a fazer, e isso não é erro.
  if (n === 0 && js.includes(jaAplicado)) {
    console.log('  · login sem ramal já vem aplicado na extensão')
    return
  }

  // Duas: o checkToken e a mutation addExtension. Outro número significa que o
  // bundle mudou, e aplicar às cegas seria adivinhação.
  if (n !== 2) {
    console.error(`✗ esperava 2 ocorrências de "${alvo}", achei ${n}.`)
    console.error('  O bundle mudou: revise o patch de login sem ramal.')
    process.exit(1)
  }
  await writeFile(file, js.replaceAll(alvo, 'const bpLogged=!!s.vxToken'), 'utf8')
  console.log('  ✓ login sem ramal habilitado (2 pontos)')
}

/**
 * Tira o "É possível que as alterações feitas não sejam salvas" de toda saída.
 *
 * O bundle registra, no instante em que o ramal registra no SIP, um
 * beforeunload que chama `e.preventDefault()` INCONDICIONALMENTE:
 *
 *     window.addEventListener("beforeunload", function (e) {
 *       return e.preventDefault(), …, t.getUserAgent().unregister(), !1
 *     })
 *
 * O objetivo do listener era só desregistrar o ramal ao fechar, e isso não
 * precisa de preventDefault nenhum. Do jeito que estava, quem deixa o webphone
 * aberto leva o diálogo de confirmação em TODA saída de página, o dia inteiro,
 * sem ligação em curso e sem nada editado.
 *
 * No SDK dói mais: em modo srcdoc o listener vive dentro do iframe, e o
 * beforeunload de um iframe participa da navegação do documento de topo — o
 * diálogo aparece na aplicação inteira do integrador, não só no webphone.
 *
 * Aqui as duas coisas viram listeners separados:
 *   · beforeunload só confirma se houver ligação em curso (`isRunningCall`,
 *     computed que o próprio componente já mantém);
 *   · pagehide desregistra sempre, sem bloquear a saída — é o evento que o
 *     resto do host já usa para saída limpa (bravophone-presenca.js) e o que
 *     dispara de forma confiável em mobile, onde beforeunload costuma não vir.
 *
 * De quebra o handler vira arrow: no original `this` era o window, então
 * `this.isDebug` era sempre undefined e aquele console.info nunca rodou.
 */
async function corrigirSaidaDaPagina() {
  const file = join(HOST, 'popup.js')
  const js = await readFile(file, 'utf8')
  const alvo = 'window.addEventListener("beforeunload",function(e){return e.preventDefault(),this.isDebug&&console.info("BravoPhone > Webphone > force unregister"),t.getUserAgent().unregister(),!1})'
  const corrigido = 'window.addEventListener("beforeunload",e=>{this.isRunningCall&&(e.preventDefault(),e.returnValue="")});window.addEventListener("pagehide",()=>{this.isDebug&&console.info("BravoPhone > Webphone > force unregister");try{t.getUserAgent().unregister()}catch(e){}})'
  const n = js.split(alvo).length - 1

  // A extensão pode já trazer a correção de fábrica — não é erro.
  if (n === 0 && js.includes(corrigido)) {
    console.log('  · saída sem confirmação já vem aplicada na extensão')
    return
  }

  // Uma só: a que o app registra depois de getUserAgent().start(). O outro
  // beforeunload do bundle é do RUM do Datadog e não bloqueia a saída.
  if (n !== 1) {
    console.error(`✗ esperava 1 ocorrência do beforeunload do webphone, achei ${n}.`)
    console.error('  O bundle mudou: revise o patch de saída da página.')
    process.exit(1)
  }
  await writeFile(file, js.replace(alvo, corrigido), 'utf8')
  console.log('  ✓ saída sem confirmação (o unregister foi para o pagehide)')
}

/**
 * Reescreve o `__webpack_public_path__` do bundle para servir sob um subpath.
 * É a troca de uma constante só, determinística e refeita a cada sync.
 */
async function rewritePublicPath(publicPath) {
  // O Git Bash no Windows converte argumentos que parecem caminho POSIX:
  // `--public-path=/embed/` chega como `C:/Program Files/Git/embed/`. Gravar
  // isso no bundle quebraria todos os assets em produção, e silenciosamente.
  const caminhoWeb = /^\/[\w\-./]*$/.test(publicPath)
  // http só para localhost: em produção o webphone exige contexto seguro.
  const urlCompleta = /^https:\/\/[\w.-]+\/[\w\-./@]*$/.test(publicPath) ||
    /^http:\/\/localhost(:\d+)?\/[\w\-./@]*$/.test(publicPath)
  if (!caminhoWeb && !urlCompleta) {
    console.error(`✗ public path inválido: "${publicPath}"`)
    console.error('  Use um caminho web (/embed/) ou uma URL https completa.')
    console.error('  No Git Bash: MSYS_NO_PATHCONV=1 npm run sync -- --public-path=/embed/')
    process.exit(1)
  }
  if (!publicPath.endsWith('/')) {
    console.error(`✗ public path precisa terminar com "/": "${publicPath}"`)
    process.exit(1)
  }

  const file = join(HOST, 'popup.js')
  const js = await readFile(file, 'utf8')
  const needle = 'n.p="/"'
  const count = js.split(needle).length - 1
  if (count !== 1) {
    console.error(`✗ esperava 1 ocorrência de ${needle} em popup.js, achei ${count}.`)
    console.error('  O bundle mudou: revise antes de reescrever o public path.')
    process.exit(1)
  }
  await writeFile(file, js.replace(needle, `n.p="${publicPath}"`), 'utf8')
  console.log(`  ✓ public path: "/" → "${publicPath}"`)
}

function buildHtml() {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="referrer" content="strict-origin">
<title>Webphone BCVOZ</title>
<link rel="icon" href="./favicon.ico">
<link rel="stylesheet" href="./css/dark-theme.css">
<link rel="stylesheet" href="./css/tema-claro.css">
<!-- Correções de tema que o dark-theme.css da extensão não cobre.
     Fica em styles/ (e não em css/) porque o sync apaga css/ inteiro. -->
<link rel="stylesheet" href="./styles/theme-fixes.css">
<style>
  /* O fundo sai do token: fixo em #1e1e2d ele vazava escuro por baixo do
     tema claro, nas bordas e enquanto o Vue nao montava. */
  html, body { margin: 0; height: 100%; background: var(--bp-bg, #1e1e2d); overflow: hidden; }
  #app { height: 100%; }
</style>

<!-- ORDEM IMPORTA: o shim precisa existir antes de qualquer código que
     toque em chrome.* durante a avaliação do bundle. -->
<!-- Mensagens de _locales/: alimentam chrome.i18n.getMessage, de onde vem
     praticamente todo label da interface. Precisa vir antes do popup.js. -->
<!-- Sem defer e primeiro: o atributo do tema tem de estar no <html>
     antes do primeiro quadro, senao o iframe pisca escuro e clareia. -->
<script src="./js/bravophone-tema.js"></script>
<script src="./shim/messages.js"></script>
<script src="./shim/chrome-shim.js"></script>
<script src="./js/libwebphone.js"></script>
<script src="./js/bravophone-route-selector.js"></script>
<!-- ANTES do popup.js de proposito: o campo precisa observar
     chrome.runtime.onMessage e o construtor do libwebphone antes de o app
     registrar o listener e instanciar o webphone. -->
<script defer src="./js/bravophone-input.js"></script>
<script defer src="./js/bravophone-presenca.js"></script>
<script defer src="./js/bravophone-aparelho.js"></script>
<script defer src="./js/bravophone-audio.js"></script>
<script defer src="./js/bravophone-qualidade.js"></script>
<script defer src="./js/bravophone-ringback.js"></script>
<script defer src="./js/bravophone-ping.js"></script>
<script defer src="./js/bravophone-qualidade-envio.js"></script>
<script defer src="./js/bravophone-janela.js"></script>
<script defer src="./popup.js"></script>
<script defer src="./js/bravophone-sem-ramal.js"></script>
<script defer src="./js/bravophone-reconectar.js"></script>
<!-- guest-bridge roda depois do app montar (defer preserva a ordem). -->
<script defer src="./shim/guest-bridge.js"></script>
</head>
<body>
<noscript><strong>O webphone precisa de JavaScript habilitado.</strong></noscript>
<div id="app"></div>
</body>
</html>
`
}

main().catch((err) => {
  console.error('✗ Falhou:', err)
  process.exit(1)
})
