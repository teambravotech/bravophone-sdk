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

import { cssDaMarca, trocasDeLink, nomeNosTextos } from './marca.js'

const CDN = 'https://cdn.jsdelivr.net/npm'

/** Base dos assets do host, travada na versão do próprio pacote. */
export function hostBase(version, pkg = '@bcvoz/webphone') {
  return `${CDN}/${pkg}@${version}/host/`
}

/**
 * Monta o documento do webphone para rodar dentro de um iframe srcdoc.
 *
 * A pré-gravação cobre a sessão do proxy (as sete chaves do bpSaveSession).
 * O ramal SIP não entra aqui — ver o comentário em `semRamal`.
 *
 * A ordem dos scripts é a mesma do host hospedado e não é negociável: as
 * mensagens precisam existir antes do shim, e o shim antes de qualquer código
 * que toque em `chrome.*` durante a avaliação do bundle.
 *
 * @param {object} o
 * @param {string} [o.email]  Sem sessão, o webphone sobe na tela de login
 *   dele. Este e-mail chega lá preenchido (ver src/login.js). Ignorado quando
 *   há sessão: aí não há tela de login, e regravar o e-mail lembrado faria o
 *   gerenciador de contas batizar a sessão com um endereço de fora.
 */
export function buildSrcdoc({ version, parentOrigin, session, base, email,
  iceServers, marca }) {
  const b = base || hostBase(version)
  const emailDeLogin = session ? null : (email || null)

  // O srcdoc é HTML dentro de um atributo: aspas duplas quebrariam o atributo.
  // Serializamos os valores como JSON e usamos aspas simples no HTML.
  // O ramal (session.extension) fica DE FORA do srcdoc de propósito: o HTML
  // vira um atributo no DOM da página do integrador, legível por qualquer
  // script dela. A credencial SIP viaja só pela ponte, por postMessage, e
  // termina no store em memória do iframe — nunca no DOM nem no localStorage.
  const semRamal = session ? { ...session, extension: undefined } : null

  // Tudo em ASCII. O srcdoc viaja como atributo do documento pai, e o charset
  // não sobrevive de forma confiável a essa passagem — acentos chegavam
  // quebrados ("atribu?do a este usu?rio"). Escapando para \uXXXX, o HTML fica
  // ASCII puro e o texto é reconstruído pelo parser de JSON, sem depender de
  // encoding em nenhum ponto do caminho.
  const cfg = JSON.stringify({ parentOrigin, session: semRamal, version,
    email: emailDeLogin, iceServers: iceServers || null,
    marcaCss: cssDaMarca(marca) || null, marcaLinks: trocasDeLink(marca),
    marcaNome: nomeNosTextos(marca) })
    .replace(/[-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
    .replace(/</g, '\\u003c')

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${nomeNosTextos(marca) === null ? 'Webphone BCVOZ' : ('Webphone ' + nomeNosTextos(marca)).trim()}</title>
<!-- CRÍTICO no modo srcdoc. O bundle referencia as imagens por caminho
     RELATIVO (src="images/answer.png"), fora do public_path. Sem <base>,
     elas resolvem contra a página do integrador — o documento herda o
     baseURI do pai — e somem todas: logo, atender, desligar, mudo, hold,
     transferir. Com <base>, resolvem contra o CDN. -->
<base href="${b}">
<link rel="stylesheet" href="${b}css/dark-theme.css">
<link rel="stylesheet" href="${b}css/tema-claro.css">
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
  // Versão do pacote: o chrome-shim a devolve em getManifest(), e é ela que
  // aparece no rodapé do login, em Ajustes e no heartbeat.
  window.__bcvozVersao = cfg.version;
  // STUN/TURN do integrador. O guest-bridge le daqui ao envolver o
  // RTCPeerConnection: o JsSIP cria a conexao com iceServers vazio e
  // sem isto o webphone depende so dos candidatos que o navegador gera.
  if (cfg.iceServers) window.__bpIceServers = cfg.iceServers;

  // White-label: o CSS vem pronto do SDK (ver src/marca.js). Entra antes do
  // bundle para que o logotipo nunca chegue a piscar na tela.
  if (cfg.marcaCss) {
    try {
      var estilo = document.createElement('style');
      estilo.textContent = cfg.marcaCss;
      document.head.appendChild(estilo);
    } catch (e) {}
  }

  // Trocar o destino de um link exige o atributo; esconder nao. Por isso o
  // observador so existe quando alguem pediu troca, e sai de cena assim que
  // a tela de login some.
  if (cfg.marcaLinks && cfg.marcaLinks.length) aplicarTrocasDeLink(cfg.marcaLinks);

  function aplicarTrocasDeLink(trocas) {
    var pendente = null;
    function aplicar() {
      pendente = null;
      for (var i = 0; i < trocas.length; i++) {
        var alvos = document.querySelectorAll('a[href*="' + trocas[i][0] + '"]');
        for (var j = 0; j < alvos.length; j++) alvos[j].setAttribute('href', trocas[i][1]);
      }
    }
    function agendar() {
      // O Vue mexe no DOM a cada tecla digitada; sem juntar as mudancas, cada
      // uma viraria uma varredura de seletor.
      if (pendente === null) pendente = setTimeout(aplicar, 150);
    }
    aplicar();
    if (window.MutationObserver) {
      new window.MutationObserver(agendar).observe(document.documentElement,
        { childList: true, subtree: true });
    }
  }
  // Grava a sessão onde o bundle procura, ANTES dele avaliar, para já subir
  // autenticado em vez de piscar a tela de login.
  //
  // As chaves e o prefixo não são escolha nossa: 'bp.local.' é como o
  // chrome-shim mapeia chrome.storage.local, e os nomes vêm do bpSaveSession
  // do bundle. Um token sozinho NÃO basta — sem sip e ramal o webphone não
  // tem o que registrar, e o RouteSelector avisa "faça login pelo webphone".
  if (cfg.session) {
    // Sessão do integrador: a identidade é dele, não da pessoa. Trocar de
    // conta aqui brigaria com a sessão que ele injeta a cada carga.
    window.__bpContasDesligadas = true;
    var s = cfg.session;
    // O TOKEN QUE A API JÁ RECUSOU NÃO VOLTA. O documento é reescrito a cada
    // carga, então reinjetar o token morto faria o webphone subir "logado" de
    // novo, tomar 401 de novo e repetir o aviso de sessão expirada em loop —
    // a queixa original, só que em outro invólucro. Quem deixa a marca é o
    // bravophone-sessao.js, no OK do aviso; um token novo não casa com ela e
    // entra normalmente.
    var morta = null;
    try { morta = localStorage.getItem('bp:sessao:morta'); } catch (e) {}
    if (morta && s.vxToken && morta === s.vxToken) {
      // Sobe deslogado de propósito: a tela de login é o lugar certo para quem
      // perdeu a sessão, e o integrador pode mandar outra por setAuth a
      // qualquer momento.
      try { localStorage.removeItem('bp.local.bravophoneVxToken'); } catch (e) {}
    } else {
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
        // A validade pertence ao token: token novo sem expiresIn não pode
        // herdar a validade do anterior, senão o bundle o julga vencido e
        // derruba o login.
        if (mapa.bravophoneVxTokenExpiresAt === null) {
          localStorage.removeItem('bp.local.bravophoneVxTokenExpiresAt');
        }
      } catch (e) {}
    }
  }

  // SÓ O E-MAIL: o login continua sendo o do webphone, feito pela pessoa.
  //
  // A tela de login do bundle lê este valor no mounted
  // (chrome.storage.sync.get('bravophoneRememberEmail'), que o shim mapeia
  // para 'bp.sync.') e sobe com o campo preenchido — falta a senha. Depois de
  // um login bem-sucedido o próprio bundle regrava a chave com o e-mail que
  // entrou, e o gerenciador de contas registra a conta por ela: só e-mail que
  // de fato logou aparece na lista.
  if (cfg.email) {
    try {
      // Já logado neste navegador? Então não há tela de login para preparar.
      // E regravar o e-mail lembrado seria pior que inútil: o gerenciador de
      // contas usa essa chave para batizar a sessão que encontra, e a conta
      // entraria na lista com o endereço de outra pessoa.
      if (!localStorage.getItem('bp.local.bravophoneVxToken')) {
        localStorage.setItem('bp.sync.bravophoneRememberEmail', JSON.stringify(cfg.email));
        focarSenhaQuandoDer();
      }
    } catch (e) {}
  }

  // O bundle QUER deixar o cursor na senha quando há e-mail lembrado:
  //
  //   mounted -> nextTick -> checkRememberEmail()  // preenche e foca a senha
  //                       -> this.$refs.email.focus()
  //
  // Na extensão o callback do chrome.storage volta depois dessa segunda
  // linha, e a senha fica focada. O shim responde na hora (localStorage é
  // síncrono), então o focus() do e-mail é o último e ganha — a primeira
  // tecla iria para um campo já preenchido. Isto devolve o cursor à senha,
  // uma vez só, e nunca tomando o foco de onde a pessoa o colocou.
  function focarSenhaQuandoDer() {
    var limite = Date.now() + 20000;
    var feito = false;
    function tentar() {
      if (feito) return;
      if (Date.now() > limite) { feito = true; return; }
      var tela = document.querySelector('.login-screen');
      var form = tela && tela.querySelector('form');
      // O campo de e-mail do bundle é type="text" (name="email"), não
      // type="email": procurar pelo tipo não acha nada. O primeiro input do
      // formulário é o caminho que o gerenciador de contas também usa.
      var mail = form && (form.querySelector('input[type=email]') ||
        form.querySelectorAll('input')[0]);
      var senha = form && form.querySelector('input[type=password]');
      // Campo já preenchido é o sinal de que o bundle leu o e-mail.
      if (!senha || !mail || !mail.value) { setTimeout(tentar, 120); return; }
      var onde = document.activeElement;
      if (onde === senha) { feito = true; return; }
      // A janela do widget costuma estar fechada quando o app monta: sem foco
      // no documento, focar daqui roubaria o cursor da página do integrador.
      if (document.hasFocus() && (!onde || onde === mail || onde === document.body)) {
        feito = true;
        senha.focus();
        return;
      }
      setTimeout(tentar, 120);
    }
    setTimeout(tentar, 150);
    // O momento útil é quando a pessoa abre o widget e clica nele.
    window.addEventListener('focus', function () { setTimeout(tentar, 0); });
  }
})();
<\/script>
<script src="${b}js/bravophone-tema.js"><\/script>
<script src="${b}shim/messages.js"><\/script>
<script>
(function () {
  // A marca tambem mora nos textos: "Acesse seu webphone BCVOZ" fica logo
  // abaixo do logotipo, e "Portal BCVOZ" no rodape. Trocar a imagem e deixar
  // as frases seria meio caminho. O shim le daqui (chrome.i18n.getMessage),
  // entao reescrever a tabela ANTES do bundle resolve tudo de uma vez.
  var nome = ${JSON.stringify(nomeNosTextos(marca))};
  if (nome === null || !window.__bpMessages) return;
  var tabela = window.__bpMessages;
  for (var k in tabela) {
    var m = tabela[k] && tabela[k].message;
    // Dominios como speedtest.bravophone.com ficam de fora de proposito: sao
    // endereco, nao marca na tela.
    if (typeof m !== 'string' || m.indexOf('BCV') < 0) continue;
    tabela[k].message = m.replace(/BCVOZ|BCVoz/g, nome).replace(/[ ]{2,}/g, ' ').trim();
  }
})();
<\/script>
<script src="${b}shim/chrome-shim.js"><\/script>
<script src="${b}js/libwebphone.js"><\/script>
<script src="${b}js/bravophone-route-selector.js"><\/script>
<!-- Antes dos demais: é para ele que todo módulo relata um 401. -->
<script defer src="${b}js/bravophone-sessao.js"><\/script>
<!-- ANTES do popup.js de proposito: o campo precisa observar
     chrome.runtime.onMessage e o construtor do libwebphone antes de
     o app registrar o listener e instanciar o webphone. -->
<script defer src="${b}js/bravophone-input.js"><\/script>
<script defer src="${b}js/bravophone-presenca.js"><\/script>
<script defer src="${b}js/bravophone-aparelho.js"><\/script>
<script defer src="${b}js/bravophone-audio.js"><\/script>
<script defer src="${b}js/bravophone-qualidade.js"><\/script>
<script defer src="${b}js/bravophone-ringback.js"><\/script>
<script defer src="${b}js/bravophone-ping.js"><\/script>
<script defer src="${b}js/bravophone-qualidade-envio.js"><\/script>
<script defer src="${b}js/bravophone-janela.js"><\/script>
<script defer src="${b}js/bravophone-contas.js"><\/script>
<script defer src="${b}popup.js"><\/script>
<script defer src="${b}js/bravophone-sem-ramal.js"><\/script>
<script defer src="${b}js/bravophone-reconectar.js"><\/script>
<script defer src="${b}js/bravophone-registro.js"><\/script>
<script defer src="${b}shim/guest-bridge.js"><\/script>
<script defer src="${b}shim/versao.js"><\/script>
</head>
<body>
<noscript><strong>O webphone precisa de JavaScript habilitado.</strong></noscript>
<div id="app"></div>
</body>
</html>`
}
