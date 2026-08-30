// Modo self-hosted: o iframe roda na origem do próprio site, e o conteúdo do
// webphone vem do CDN.
//
// Por que existe: no modo hospedado o iframe navega para
// webphone.bravophone.com, o que exige manter esse domínio e sujeita o widget
// às restrições de iframe de terceiros — bloqueadores de privacidade, política
// corporativa, storage particionado. Com `srcdoc` o documento é same-origin
// com o site do integrador e nada disso se aplica.
//
// O que isso NÃO resolve: o `Origin` dos requests passa a ser o do cliente,
// então os backends precisam ter essa origem na allowlist de CORS. Sem isso o
// webphone carrega mas não registra.
//
// Validado em navegador (examples/srcdoc-validation.html): getUserMedia
// funciona sem `allow=`, `localStorage` funciona, `document.baseURI` resolve
// para a página pai e `@font-face` com URL absoluta do CDN carrega.

const CDN = 'https://cdn.jsdelivr.net/npm'

/** Base dos assets do host, travada na versão do próprio pacote. */
export function hostBase(version, pkg = '@bravophone/webphone') {
  return `${CDN}/${pkg}@${version}/host/`
}

/**
 * Monta o documento do webphone para rodar dentro de um iframe srcdoc.
 *
 * A ordem dos scripts é a mesma do host hospedado e não é negociável: as
 * mensagens precisam existir antes do shim, e o shim antes de qualquer código
 * que toque em `chrome.*` durante a avaliação do bundle.
 */
export function buildSrcdoc({ version, parentOrigin, session, base }) {
  const b = base || hostBase(version)

  // O srcdoc é HTML dentro de um atributo: aspas duplas quebrariam o atributo.
  // Serializamos os valores como JSON e usamos aspas simples no HTML.
  const cfg = JSON.stringify({ parentOrigin, session: session || null })
    .replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Webphone BRAVOPHONE</title>
<!-- CRÍTICO no modo srcdoc. O bundle referencia as imagens por caminho
     RELATIVO (src="images/answer.png"), fora do public_path. Sem <base>,
     elas resolvem contra a página do integrador — o documento herda o
     baseURI do pai — e somem todas: logo, atender, desligar, mudo, hold,
     transferir. Com <base>, resolvem contra o CDN. -->
<base href="${b}">
<link rel="stylesheet" href="${b}css/dark-theme.css">
<link rel="stylesheet" href="${b}styles/theme-fixes.css">
<style>
  html, body { margin: 0; height: 100%; background: #10131c; overflow: hidden; }
  #app { height: 100%; }
</style>
<script>
(function () {
  var cfg = ${cfg};
  // O guest-bridge lê daqui: em srcdoc não há query string para carregar a
  // origem do pai.
  window.__bpParentOrigin = cfg.parentOrigin;
  // Grava a sessão onde o bundle procura, ANTES dele avaliar, para já subir
  // autenticado em vez de piscar a tela de login.
  //
  // As chaves e o prefixo não são escolha nossa: 'bp.local.' é como o
  // chrome-shim mapeia chrome.storage.local, e os nomes vêm do bpSaveSession
  // do bundle. Um token sozinho NÃO basta — sem sip e ramal o webphone não
  // tem o que registrar, e o RouteSelector avisa "faça login pelo webphone".
  if (cfg.session) {
    var s = cfg.session;
    var mapa = {
      bravophoneVxToken: s.vxToken || null,
      bravophoneVxTokenExpiresAt: s.expiresIn ? Date.now() + 1000 * Number(s.expiresIn) : null,
      bravophoneSip: s.sip || null,
      bravophoneTenant: s.tenant || null,
      bravophoneRamal: s.ramal || null,
      bravophoneClienteId: s.clienteId || null,
      bravophoneRamaisUrl: s.ramaisUrl || null
    };
    try {
      for (var k in mapa) {
        if (mapa[k] !== null) localStorage.setItem('bp.local.' + k, JSON.stringify(mapa[k]));
      }
    } catch (e) {}
  }
})();
<\/script>
<script src="${b}shim/messages.js"><\/script>
<script src="${b}shim/chrome-shim.js"><\/script>
<script src="${b}js/libwebphone.js"><\/script>
<script src="${b}js/bravophone-route-selector.js"><\/script>
<script defer src="${b}popup.js"><\/script>
<script defer src="${b}shim/guest-bridge.js"><\/script>
</head>
<body>
<noscript><strong>O webphone precisa de JavaScript habilitado.</strong></noscript>
<div id="app"></div>
</body>
</html>`
}
