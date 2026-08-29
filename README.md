# @bravophone/webphone

Webphone BRAVOPHONE embutível em qualquer página web. Uma linha de `<script>` e o
softphone aparece como uma janela flutuante arrastável, com as mesmas
funcionalidades da extensão de navegador.

```html
<script src="https://cdn.jsdelivr.net/npm/@bravophone/webphone"></script>
<script>
  Bravophone.init({ token: 'TOKEN_DO_USUARIO' })
</script>
```

```js
// ou via npm
import Bravophone from '@bravophone/webphone'

Bravophone.init({ token, position: 'bottom-right' })
Bravophone.on('call:incoming', ({ number }) => console.log('ligação de', number))
await Bravophone.call('11987654321')
```

---

## A decisão de arquitetura

O ponto de partida é uma restrição concreta: **`popup.js` tem 932 KB de build Vue
minificado e o código-fonte não está disponível.** Recompilar não é uma opção, então
o projeto foi desenhado para **reaproveitar o bundle exatamente como está**.

O levantamento do uso de `chrome.*` no bundle mostrou que isso é viável — a
superfície é pequena e concentrada:

| API | Usos | Tratamento |
|---|---|---|
| `chrome.storage.sync` | 58 | shim → `localStorage` |
| `chrome.storage.local` | 10 | shim → `localStorage` |
| `chrome.storage.onChanged` | 4 | shim → emissor próprio |
| `chrome.runtime.onMessage` | 3 | shim → barramento local |
| `chrome.tabs.create` | 3 | shim → `window.open` |
| `chrome.windows.*` | 6 | shim → delega ao widget via bridge |

São **três superfícies reais**, todas sem estado remoto. Um shim de ~230 linhas cobre
todas — é o [`host/shim/chrome-shim.js`](host/shim/chrome-shim.js).

### Dois artefatos, não um

```
┌─ SITE DO CLIENTE (qualquer origem) ────────────────────────┐
│                                                             │
│   <script src="cdn.../@bravophone/webphone">                │
│            │                                                │
│            ▼                                                │
│   ┌─ SDK (11 KB) ──────────────────────┐                    │
│   │  Shadow DOM · janela arrastável    │                    │
│   │  API pública · ponte postMessage   │                    │
│   │                                    │                    │
│   │   ┌─ <iframe> ──────────────────┐  │                    │
│   │   │  origem FIXA:               │  │                    │
│   │   │  webphone.bravophone.com    │  │                    │
│   │   │                             │  │                    │
│   │   │  chrome-shim.js             │  │                    │
│   │   │  libwebphone.js   (604 KB)  │  │                    │
│   │   │  popup.js         (932 KB)  │  │  ← bundle intacto  │
│   │   │  guest-bridge.js            │  │                    │
│   │   └─────────────────────────────┘  │                    │
│   └────────────────────────────────────┘                    │
└─────────────────────────────────────────────────────────────┘
```

**O SDK no npm/CDN é leve (11 KB / 4,6 KB gzip).** Todo o peso do webphone fica no
host e carrega sob demanda, quando o usuário abre a janela.

### Por que iframe, e não montar o Vue direto na página

Testei mentalmente as duas rotas; o iframe ganha em quatro frentes de uma vez:

1. **CSS.** O bundle traz Tailwind + `dark-theme.css` globais. Injetado na página do
   cliente, ele quebraria o site do cliente — e o CSS do cliente quebraria o webphone.
2. **CORS, e este é o argumento decisivo.** Dentro do iframe, todo request para
   `api.bravophone.com`, `reports.teambravotech.com` e `devices.wavoip.com` sai com
   `Origin: https://webphone.bravophone.com` — **uma origem só, fixa**. Sem iframe,
   cada cliente novo exigiria liberar mais uma origem no CORS de três backends. Com
   iframe, a lista de origens do backend nunca cresce.
3. **Microfone.** `allow="microphone"` no iframe é um contrato explícito e auditável.
4. **Atualização.** Corrigiu algo no webphone? Republique o host. Todos os clientes
   recebem sem trocar a versão do pacote npm.

---

## O que muda em relação à extensão

### Login: o ponto que exige decisão de produto

Este é o único item que **não** tem solução puramente técnica, e vale ler antes de
começar.

Desde o Chrome 115, o *storage partitioning* é padrão: o `localStorage` de um iframe
cross-origin é **particionado pelo site que o contém**. Na prática, um usuário logado
no webphone em `clienteA.com` **não** estará logado em `clienteB.com` — mesmo sendo o
mesmo iframe, o mesmo usuário e a mesma origem. A extensão nunca teve esse problema
porque tinha um storage único.

Três caminhos, em ordem de recomendação:

1. **Token do integrador (recomendado).** O backend do cliente emite um token de sessão
   e passa em `Bravophone.init({ token })`. O SDK entrega ao iframe pela ponte e o
   `guest-bridge` grava onde o bundle já procura (`vxToken`). Sem tela de login, sem
   depender de cookie de terceiros, e é o modelo que Intercom/Twilio usam. Combina bem
   com o fato de que [o `vxToken` é eterno](#) — só logout explícito o encerra.
2. **Login em popup window.** `window.open` para a origem do webphone (contexto
   *first-party*, sem partição), token volta por `postMessage`. Bom se não houver
   backend do lado do cliente.
3. **Storage Access API.** Exige gesto do usuário e o suporte varia entre navegadores.
   Serve como *fallback*, não como plano principal.

O SDK já implementa o caminho 1 de ponta a ponta.

### Funcionalidades que não portam

Os ~25 `content-script-*.js` (Pipedrive, HubSpot, Kommo, Salesforce…) injetam
click-to-call em CRMs de terceiros. **Isso é território exclusivo de extensão** — uma
biblioteca só roda onde foi incluída.

A substituição é a inversão do controle: em vez de o Bravophone entrar no CRM, o CRM
chama o Bravophone.

```js
document.querySelectorAll('[data-phone]').forEach((el) => {
  el.onclick = () => Bravophone.call(el.dataset.phone, { source: 'crm', id: el.dataset.id })
})
```

Também ficam de fora `contextMenus` (menu de contexto do navegador), `devtools.js` e a
leitura de clipboard sem gesto do usuário.

### O que se mantém idêntico

Registro SIP, áudio WebRTC, supressão de ruído, seleção de rota, histórico, contatos,
transferência, DTMF, e a **normalização de número** — inclusive a regra de
[nunca inserir o 9º dígito](#): `dialpad.call()` continua sendo o funil único de
ligações, então toda essa lógica é exatamente a mesma da extensão.

---

## Estrutura

```
Bravophone-SDK/
├── src/                    ← vira o pacote npm (11 KB)
│   ├── index.js              API pública + registro de eventos
│   ├── widget.js             Shadow DOM, iframe, launcher
│   ├── draggable.js          arraste/resize com Pointer Events + persistência
│   ├── bridge.js             RPC postMessage (lado host)
│   └── styles.js             CSS isolado do widget
│
├── host/                   ← vira webphone.bravophone.com (RAIZ do domínio)
│   ├── index.html            gerado pelo sync (ordem de scripts importa)
│   ├── shim/chrome-shim.js   emula chrome.* para o bundle
│   ├── shim/guest-bridge.js  RPC (lado iframe) + eventos + arraste interno
│   ├── allowed-origins.json  origens autorizadas a embutir
│   ├── popup.js  js/  css/   ┐ copiados da extensão pelo sync,
│   ├── fonts/  images/       ┘ na RAIZ — não versionados (ver abaixo)
│   ├── mock.html             ┐ só desenvolvimento:
│   └── mock-webphone.js      ┘ webphone falso, sem SIP nem backend
│
├── scripts/
│   ├── sync-from-extension.mjs   copia os assets da extensão
│   ├── dev-server.mjs            duas origens locais (5173 / 5174)
│   └── smoke-shim.mjs            testes do chrome-shim
├── types/index.d.ts
└── examples/
    ├── test.html             painel de teste completo (usa o build UMD)
    └── basic.html            exemplo mínimo de integração
```

**A extensão é a fonte da verdade.** Nada copiado é editado à mão. Quando a extensão
for atualizada:

```bash
npm run sync    # copia popup.js, libwebphone.js, css, fonts… (ignora .bak-*)
```

O script recusa rodar se um asset obrigatório sumir, em vez de gerar um host quebrado
silenciosamente.

### Por que os assets ficam na raiz de `host/`, e não num `vendor/`

O bundle foi buildado com `__webpack_public_path__ = "/"`. Duas fontes são resolvidas
por esse caminho absoluto:

```js
n.p + "fonts/Audiowide-Regular.ttf"   // Audiowide — a fonte da marca
n.p + "fonts/Seguiemj.ttf"            // SegoeUIEmoji — os emojis
```

Sob um subdiretório, esses dois pedidos dão 404 e o navegador cai no fallback
silenciosamente — sem erro visível, só a tipografia errada, e justamente **depois do
login**, que é onde a Audiowide aparece. Replicar o layout de URL da extensão faz tudo
resolver sem tocar no bundle: `npm run sync` termina verificando que as duas fontes
aterrissaram em `/fonts/`, e falha alto se não.

**Consequência de deploy:** o host precisa ficar na **raiz** de um domínio ou
subdomínio. Para servir sob um subpath, use
`npm run sync -- --public-path=/embed/` — troca só essa constante no bundle, de forma
determinística e refeita a cada sync (e aborta se não encontrar exatamente uma
ocorrência, em vez de adivinhar).

---

## Desenvolvimento

### Pré-requisito: a extensão ao lado

Este repositório **não versiona o webphone** — só o SDK e a camada que faz o bundle da
extensão rodar fora dela. O `popup.js` (932 KB), o `libwebphone.js`, as fontes e os
`_locales` são copiados da extensão pelo `npm run sync` e ficam fora do git.

Clone os dois como irmãos:

```
algum-diretorio/
├── Bravophone/       ← a extensão (fonte da verdade do webphone)
└── bravophone-sdk/   ← este repositório
```

```bash
git clone https://github.com/teambravotech/bravophone-sdk.git
cd bravophone-sdk
npm install
npm run sync      # copia os assets da extensão irmã
npm run build     # gera dist/ (ESM + UMD + sourcemaps)
npm start         # sobe as duas origens de teste
```

Se a extensão estiver em outro lugar, passe o caminho:
`npm run sync -- /caminho/para/Bravophone`.

Sem o `sync`, o host não tem o que servir — `npm start` sobe, mas o webphone real não
carrega (o mock em `?host=mock` continua funcionando).

### Scripts

| Script | O que faz |
|---|---|
| `npm run sync` | Copia os assets da extensão, gera `host/index.html` e `shim/messages.js`, e roda a auditoria de tema |
| `npm run build` | Gera `dist/` — o que vai para o npm |
| `npm start` | Sobe as duas origens locais (5173 site, 5174 host) |
| `npm test` | 100 asserções: shim, geometria da janela e aba de abertura |
| `npm run audit:theme` | Procura texto invisível no tema escuro |

Abra **http://localhost:5173/**.

O `npm start` sobe duas portas de propósito — origens diferentes fazem o teste
exercitar o postMessage cross-origin de verdade, incluindo a validação de origem:

| Porta | Papel | Serve |
|---|---|---|
| 5173 | site do cliente | `examples/test.html`, carrega `dist/bravophone.umd.cjs` por `<script>`, como no CDN |
| 5174 | host do webphone | `host/mock.html`, com os headers `frame-ancestors` e `Permissions-Policy` de produção |

### Testar sem SIP nem backend

O `host/mock.html` carrega **o `chrome-shim.js` e o `guest-bridge.js` reais** e troca
só o bundle por [`host/mock-webphone.js`](host/mock-webphone.js), que expõe os mesmos
dois handles que o guest-bridge procura (`window.dialpad` e `window.libwebphone`).
Ou seja: o caminho testado é o de produção, sem depender de registro SIP.

Dá para verificar ponta a ponta o arraste e o resize, a persistência da posição, os
comandos (`call`/`hangup`/`mute`/`transfer`…), os eventos de volta, uma chamada
entrante abrindo a janela sozinha, e o `init({ token })` chegando ao storage via shim —
o painel do mock mostra o `vxToken` gravado.

Para testar contra o **webphone real**, rode `npm run sync` e aponte o `hostUrl` do
`examples/test.html` para `http://localhost:5174/index.html` em vez de `mock.html`.

```bash
npm test          # 18 asserções sobre o chrome-shim, sem browser
```

---

## Deploy

### 1. Host — `webphone.bravophone.com` (raiz)

Estático (S3+CloudFront, Vercel, nginx). Três headers importam:

```
Content-Security-Policy: frame-ancestors 'self' https://clienteA.com https://clienteB.com;
Permissions-Policy: microphone=(self)
Cross-Origin-Opener-Policy: same-origin-allow-popups
```

`frame-ancestors` é o que impede qualquer site de embutir o webphone — deve ser gerado
a partir de `allowed-origins.json`. É a mesma disciplina de
[autorização por origem](#) que a extensão já adota; não troque por `*`.

Cache: `popup.js`, `js/*`, `fonts/*` com `max-age=31536000` (invalide o CDN a cada
sync, ou versione por query string); `index.html` sempre com `no-cache`.

### 2. Backends — CORS

Liberar **uma única origem** em `api.bravophone.com`, `reports.teambravotech.com` e
`devices.wavoip.com`:

```
Access-Control-Allow-Origin: https://webphone.bravophone.com
Access-Control-Allow-Credentials: true
```

Como o iframe tem origem fixa, essa lista não cresce com o número de clientes.

### 3. npm

```bash
npm publish --access public
```

Disponível em `cdn.jsdelivr.net/npm/@bravophone/webphone` e `unpkg.com` logo após.
Recomende aos integradores a versão travada — `@bravophone/webphone@0.1` — para que
um major não quebre a página deles.

---

## API

### `Bravophone.init(options)`

| Opção | Tipo | Padrão | Descrição |
|---|---|---|---|
| `token` | `string` | — | Token de sessão emitido pelo seu backend |
| `hostUrl` | `string` | `https://webphone.bravophone.com/embed/` | Origem do webphone |
| `position` | `string` | `'bottom-right'` | Canto inicial |
| `open` | `boolean` | `false` | Abrir já visível |
| `launcher` | `boolean` | `true` | Exibir a aba lateral de abertura |
| `launcherSide` | `'right' \| 'left'` | `'right'` | Lado em que a aba fica colada |
| `frame` | `'none' \| 'bar'` | `'none'` | Moldura da janela — ver abaixo |
| `dockTop` | `'max' \| 'top-half'` | `'max'` | O que arrastar até a borda superior faz |
| `title` | `string` | `'BRAVOPHONE'` | Texto da barra (só com `frame: 'bar'`) |

### Moldura: preservando 100% da UI

Por padrão (`frame: 'none'`) **não há barra de título** — a UI do `popup.js` ocupa a
janela inteira, exatamente como na extensão. Nenhum pixel é tomado.

O arraste continua funcionando porque a detecção do gesto acontece **dentro** do
iframe, no `guest-bridge.js`: o host é cross-origin e não pode tocar naquele DOM, então
o gesto viaja como delta pela ponte. Qualquer área que não seja botão, campo ou link
arrasta a janela; o resto continua clicável, e uma seleção de texto em andamento nunca
é sequestrada. As coordenadas usam `screenX/screenY` — absolutas na tela, imunes ao
fato de o próprio iframe estar se movendo durante o arraste.

Um botão de fechar aparece sobreposto no canto ao passar o mouse, sem empurrar o
conteúdo. Recolher para o launcher faz o papel de minimizar.

Use `frame: 'bar'` se preferir a barra com título, indicador de estado e controles.

### Métodos

**Janela** — `show()` · `hide()` · `toggle()` · `minimize(force?)` · `move(x, y)` ·
`resize(w, h)` · `dock(zone)` · `destroy()` · `isOpen` · `geometry`

### A aba de abertura

Com a janela fechada, o webphone fica acessível por uma **aba colada na lateral** da
viewport — não um botão circular solto no canto. Ela é arrastável na vertical e
guarda a posição entre sessões.

No repouso mostra só o ícone. No **hover** (ou com foco de teclado) ela expande e
revela a alça de pontinhos, sinalizando que dá para arrastar.

Um detalhe que decide se o componente é agradável ou irritante: **arrastar não abre o
webphone**. O gesto vira arraste depois de 4px percorridos; abaixo disso continua sendo
clique. Sem esse limiar, uma tremida de mouse no clique abriria a janela sem querer —
ou pior, todo arraste terminaria abrindo.

A aba também responde a teclado (`Enter` / `Espaço`) e, numa chamada entrante, pulsa em
vermelho com o contador — visível mesmo com a janela fechada.

```js
Bravophone.init({ launcherSide: 'left' })   // cola do outro lado
Bravophone.setLauncherSide('right')         // troca em runtime
Bravophone.init({ launcher: false })        // sem aba: você controla com show()
```

### Redimensionar e encaixar

A janela redimensiona por **qualquer borda ou canto** — as alças laterais são o que
permite alargar a janela para o histórico de chamadas respirar. O teto é a viewport,
não um valor fixo.

Dois comportamentos de encaixe, ambos com o mesmo vocabulário do Canva:

**Arrastando**, encostar numa região da viewport mostra uma prévia azul do encaixe
antes de soltar:

| Onde o cursor chega | Encaixe |
|---|---|
| borda esquerda / direita | altura cheia, largura mantida |
| **borda inferior** | **metade inferior, largura cheia** |
| borda superior | maximizado (configurável) |
| os quatro cantos | meia tela esquerda/direita |
| qualquer outro lugar | segue flutuando |

```
 left-half │    max     │ right-half
 ──────────┼────────────┼──────────
   left    │  (flutua)  │   right
 ──────────┼────────────┼──────────
 left-half │bottom-half │ right-half
```

A borda superior é a única disputada: `max` é o gesto universal (Windows, macOS), mas
quem trabalha com metades verticais costuma preferir a metade de cima ali. Daí a opção
`dockTop`:

```js
Bravophone.init({ dockTop: 'top-half' })   // topo encaixa na metade superior
```

Com ela, o máximo continua acessível por `dock('max')`.

Arrastar uma janela encaixada de volta para o meio a solta e devolve o tamanho que ela
tinha antes — e a janela nasce **sob o cursor**, proporcional a onde você a pegou, em
vez de saltar.

**Redimensionando**, chegar a ~32px de uma borda da viewport completa até ela
sozinha — o "completamento sugestivo".

Programaticamente:

```js
Bravophone.dock('right')        // altura cheia à direita, largura mantida
Bravophone.dock('right-half')   // metade direita  (W/2 × altura cheia)
Bravophone.dock('bottom-half')  // metade inferior (largura cheia × H/2)
Bravophone.dock('top-half')     // metade superior
Bravophone.dock('bottom')       // metade inferior, mantendo a largura atual
Bravophone.dock('max')          // maximiza
Bravophone.dock('float')        // solta e restaura o tamanho anterior

Bravophone.on('resize', ({ width, height, dock }) => { /* … */ })
```

O encaixe persiste entre sessões e é **recalculado para a viewport atual** ao recarregar
— uma janela docada ontem numa tela larga não volta com a geometria de ontem.

**Telefonia** — todos retornam `Promise`:
`call(number, meta?)` · `hangup()` · `answer()` · `mute(on?)` · `hold(on?)` ·
`sendDTMF(tone)` · `transfer(to)` · `getStatus()` · `setAuth(token)` · `logout()`

### Eventos

```js
const off = Bravophone.on('call:incoming', (call) => { /* … */ })
off()  // remove o listener
```

`ready` · `state` · `call:incoming` · `call:answered` · `call:ended` · `call:failed` ·
`open` · `close` · `error`. Use `'*'` para receber todos como `{ event, payload }`.

---

## Requisitos

- **HTTPS obrigatório** no site do cliente — `getUserMedia` só existe em *secure
  context*. `localhost` funciona no desenvolvimento; o SDK avisa no console se detectar
  contexto inseguro.
- Navegadores com WebRTC e Shadow DOM: Chrome/Edge 88+, Firefox 90+, Safari 14+.
- O site do cliente **não** pode ter um CSP `frame-src` que bloqueie
  `webphone.bravophone.com` — vale documentar isso no onboarding.

---

## Licença

Software proprietário da **BravoTech**. Todos os direitos reservados.
O pacote npm é publicado para consumo pelos integradores; o código deste repositório
não é open source.
