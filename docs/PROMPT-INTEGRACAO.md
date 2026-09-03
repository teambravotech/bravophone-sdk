# Prompt: integrar o Bravophone SDK sempre na última versão, de forma assíncrona

Cole o bloco abaixo (do primeiro `---` até o último) no Claude — ou em qualquer
agente de IA — junto com o código da página/app onde o webphone vai entrar.

Antes de colar, troque os três marcadores:

- `{{STACK}}` — HTML puro, React, Vue 3, Angular, Svelte, Next.js, Nuxt…
- `{{ONDE_A_SESSAO_VEM}}` — o endpoint ou estado de onde sai a resposta do
  `/api/voxfree/login` (ex.: `GET /me/webphone-session` do seu backend).
- `{{ONDE_APARECE}}` — em que telas o webphone deve existir (ex.: em todo o app
  depois do login).

---

## Tarefa

Integre o webphone **BRAVOPHONE** (`@bravophone/webphone`) em uma aplicação
**{{STACK}}**. O widget deve:

1. carregar **sempre a última versão publicada**, sem que ninguém edite código
   a cada release;
2. carregar de forma **assíncrona e não bloqueante** — nada de `<script>` que
   segure o parser ou o primeiro paint;
3. montar **uma única vez**, sobrevivendo a re-render, HMR e React StrictMode;
4. falhar de forma visível no console e nunca derrubar a página.

A sessão do usuário vem de **{{ONDE_A_SESSAO_VEM}}**. O webphone deve aparecer
em **{{ONDE_APARECE}}**.

Não invente métodos, eventos ou opções: o contrato completo está abaixo. Se
algo que eu pedir não existir na API, diga isso em vez de supor um nome
plausível.

## Regra 1 — como buscar "a última versão" (não é a URL sem versão)

A URL sem versão parece a resposta óbvia e é **a pior opção**. O jsDelivr
entrega `/npm/@bravophone/webphone` e as faixas (`@0.7`) com
`max-age=604800`: sete dias de cache **no navegador de quem acessa**. Publicar
uma correção não alcança essa pessoa, e purgar o CDN não adianta — o cache
está na máquina dela. Já a URL com versão exata é `immutable`.

O caminho correto tem duas etapas:

1. perguntar ao CDN qual é a versão publicada (resposta de ~1 kB, com
   `cache: 'no-store'` para não ficar até 5 min desatualizada);
2. carregar o bundle **daquela versão exata** — URL imutável, cache eterno.

Uma publicação chega em minutos e o bundle nunca precisa ser revalidado.

Use exatamente este loader — módulo isolado, idempotente, com timeout e
fallback. Ele é a **única** forma de o SDK entrar na página:

```js
// bravophone-loader.js — não altere a estratégia de versão sem ler a Regra 1.
const PACOTE = '@bravophone/webphone'
const META = `https://data.jsdelivr.com/v1/packages/npm/${PACOTE}/resolved`
const ARQUIVO = 'dist/bravophone.umd.js'

export function carregarBravophone({ timeout = 12000 } = {}) {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Bravophone: só roda no browser.'))
  }
  if (window.Bravophone) return Promise.resolve(window.Bravophone)
  // A promessa mora no window, não no módulo: com bundle duplicado ou HMR,
  // duas cópias do módulo ainda compartilham um único carregamento.
  if (window.__bpCarregando) return window.__bpCarregando

  window.__bpCarregando = (async () => {
    const versao = await resolverVersao(timeout)
    const url = versao
      ? `https://cdn.jsdelivr.net/npm/${PACOTE}@${versao}/${ARQUIVO}`
      // Sem versão resolvida (proxy, rede), a URL sem versão ainda funciona:
      // pode estar até 7 dias atrás, mas é melhor que webphone nenhum.
      : `https://cdn.jsdelivr.net/npm/${PACOTE}`

    await injetar(url, timeout)
    if (!window.Bravophone) {
      throw new Error('Bravophone: o script carregou mas a API não apareceu')
    }
    return window.Bravophone
  })()

  // Falha não pode ficar cacheada: a próxima chamada precisa poder tentar.
  window.__bpCarregando.catch(() => { window.__bpCarregando = null })
  return window.__bpCarregando
}

async function resolverVersao(timeout) {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), Math.min(timeout, 4000))
    const resp = await fetch(META, { signal: ctrl.signal, cache: 'no-store' })
    clearTimeout(t)
    if (!resp.ok) return null
    const dados = await resp.json()
    // Confere o formato: um proxy corporativo devolve HTML com 200.
    return /^\d+\.\d+\.\d+/.test(dados.version || '') ? dados.version : null
  } catch {
    return null
  }
}

function injetar(url, timeout) {
  return new Promise((ok, erro) => {
    const s = document.createElement('script')
    s.src = url
    s.async = true          // assíncrono: não segura o parser nem o paint
    const t = setTimeout(() => {
      s.remove()
      erro(new Error(`Bravophone: o CDN não respondeu em ${timeout} ms`))
    }, timeout)
    s.onload = () => { clearTimeout(t); ok() }
    s.onerror = () => {
      clearTimeout(t); s.remove()
      erro(new Error('Bravophone: falha ao carregar (rede, bloqueador ou CSP)'))
    }
    document.head.appendChild(s)
  })
}
```

Complementos que valem em qualquer stack:

```html
<link rel="preconnect" href="https://data.jsdelivr.com">
<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>
```

**Não instale o SDK como dependência de runtime.** `npm i @bravophone/webphone`
congela a versão no seu build — exatamente o que este loader existe para
evitar. Se quiser tipagem, instale o pacote como `devDependency` e importe só
os tipos:

```ts
import type { BravophoneAPI, BravophoneSession } from '@bravophone/webphone'
```

Trave a versão com `<script src=".../@0.7.1/dist/bravophone.umd.js">` **apenas**
se eu pedir explicitamente (política de build, SRI, integração de terceiros).

## Regra 2 — montar uma vez só

`Bravophone.init()` é idempotente: chamar de novo devolve a mesma instância e
**ignora as novas opções**. Para trocar de configuração é `destroy()` + `init()`.

Consequências que você precisa respeitar:

- O widget é um **singleton global**, não um componente. Monte-o no ponto mais
  alto do app autenticado, não dentro de uma tela que remonta.
- `destroy()` limpa **todos** os listeners registrados. Só chame no logout de
  verdade (ou ao desmontar o app inteiro), nunca no cleanup de um efeito que o
  React roda duas vezes em desenvolvimento.
- Cada componente que escuta eventos remove **o seu próprio** listener pela
  função devolvida por `on()`.

## Regra 3 — a sessão

`init()` recebe a resposta do `/api/voxfree/login` **inteira**:

```js
Bravophone.init({
  session: {
    vxToken:   '…',   // obrigatório
    expiresIn: 3600,
    sip:       '…',   // sem isto o webphone não registra
    ramal:     '…',   // idem
    tenant:    '…',
    clienteId: '…',
    ramaisUrl: '…',
    // A segunda metade. Sem ela o app fica na tela de login mesmo com um
    // vxToken válido: o checkToken exige as duas.
    extension: { username: '…', password: '…', server: '…' },
  },
})
```

- `token: '…'` é aceito como atalho para `{ vxToken }`, mas **sozinho não
  basta**: carrega, não registra, e o seletor de rota avisa "faça login pelo
  webphone".
- Nunca escreva a sessão literal no HTML nem em arquivo versionado. Ela é por
  usuário e vem de {{ONDE_A_SESSAO_VEM}} em runtime.
- Trocar de usuário sem recarregar: `setAuth(session)`.
- `apiBase: 'https://pabx.teambravotech.com'` (opcional) faz o SDK acompanhar o
  ramal: se um for atribuído ou trocado no painel, o webphone reage sem novo
  login.

## Contrato da API (não invente nada fora daqui)

O UMD expõe `window.Bravophone`. **Não** use `Bravophone.default`.

### `init(options)` — chame com o `<body>` já existindo

| Opção | Tipo | Padrão | Nota |
|---|---|---|---|
| `session` | `object` | — | Resposta do login, inteira. O caminho correto |
| `token` | `string` | — | Atalho para `{ vxToken }`; insuficiente sozinho |
| `apiBase` | `string` | `https://pabx.teambravotech.com` | Acompanha o ramal do usuário |
| `mode` | `'srcdoc' \| 'hosted'` | `'srcdoc'` | `'hosted'` **exige** `hostUrl` |
| `hostUrl` | `string` | — | Só em `hosted`; sem default, de propósito |
| `hostBase` | `string` | CDN desta versão | Só em `srcdoc`; deve terminar em `/` |
| `frame` | `'bar' \| 'none'` | `'bar'` | `'none'` = sem barra, UI ocupa 100% |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Canto inicial |
| `open` | `boolean` | `false` | `false` = começa recolhido na aba lateral |
| `launcher` | `boolean` | `true` | Aba lateral de abertura |
| `launcherSide` | `'right' \| 'left'` | `'right'` | Borda em que a aba cola |
| `launcherIcon` | `'phone-waves' \| 'waveform' \| 'headset' \| 'chat-phone'` | `'phone-waves'` | |
| `dockTop` | `'max' \| 'top-half'` | `'max'` | O que arrastar até o topo faz |
| `title` | `string` | `'BRAVOPHONE'` | Só com `frame: 'bar'` |

`'srcdoc'` (padrão) roda o iframe na origem do próprio site e busca o webphone
no CDN — sem iframe de terceiro e sem storage particionado, mas **exige que a
origem do site esteja na allowlist de CORS dos backends do Bravophone**.
`'hosted'` navega para o domínio do Bravophone: origem fixa no CORS, em troca
de ser iframe de terceiro (bloqueadores, storage particionado).

### Telefonia — tudo devolve `Promise`

`call(number, meta?)` · `answer()` · `hangup()` · `mute()` · `hold()` ·
`sendDTMF(tone)` · `transfer(to)` · `getStatus()` · `setDial(number)` ·
`clearDial()` · `getRoutes()` · `setRoute(id)` · `setAuth(session)` · `logout()`

`meta` de `call()`, todos opcionais: `{ name, crm, photo, gateway, dealId, url }`.
`getStatus()` devolve `{ ready, inCall, phase, number, incoming, muted, held }`.

### Janela

`show()` · `hide()` · `toggle()` · `reveal()` · `minimize(force?)` ·
`move(x, y)` · `resize(w, h)` · `dock(zone)` · `destroy()`

`dock`: `'left'`, `'right'`, `'left-half'`, `'right-half'`, `'top-half'`,
`'bottom-half'`, `'top'`, `'bottom'`, `'max'`, `'float'`.
Aba lateral: `setLauncherSide('right' | 'left')` · `setLauncherIcon(nome)`.
Propriedades: `version` · `isOpen` · `geometry`.

### Eventos

```js
const off = Bravophone.on('call:incoming', (call) => { /* … */ })
off()   // remove
```

`ready` `{version}` · `state` `{state: 'connecting'|'ready'|'ringing'|'incall'|'error'}` ·
`call:dialing` · `call:incoming` · `call:answered` · `call:ended` (todos com
`CallInfo` = `{ id, number, direction }`) · `resize` `{width, height, dock}` ·
`extension` `{hasExtension, reason, message}` · `open` · `close` · `reveal` ·
`error` `{message}`. Use `on('*', ({event, payload}) => …)` só para depurar.

## As armadilhas que mais custam tempo

1. **HTTPS ou `localhost`.** `getUserMedia` não existe fora de contexto seguro;
   o webphone carrega e nunca captura áudio. O SDK avisa no console, não lança.
2. **`mute()` e `hold()` não aceitam argumento** — são toggle. `mute(true)` não
   faz o que parece: o argumento é ignorado.
3. **`call()` pode rejeitar** (número inválido, webphone ainda subindo).
   Sempre `.catch()`: sem ele o clique do usuário falha em silêncio.
4. **Não existe `call:failed`.** Chamada que não completa chega como `call:ended`.
5. **O widget vive em Shadow DOM.** `document.querySelector` não acha nada e o
   CSS da página não alcança o widget. Configure por `init()`, não por CSS.
6. **CSP**, se houver: liberar `cdn.jsdelivr.net` em `script-src`, `style-src` e
   `font-src`, e `data.jsdelivr.com` em `connect-src`.
7. **SSR**: `init()` toca `document.body`. Nada de import estático em código que
   roda no servidor.
8. **`init()` uma vez.** Re-render não pode remontar o widget.

## Como implementar em {{STACK}}

Escolha o padrão da stack e siga-o. Em todos, o loader acima é o mesmo arquivo.

### HTML puro / jQuery / Tag Manager

Cole o loader **inline** no HTML — um arquivo `.js` externo traria de volta o
problema de cache que ele existe para evitar. Chame-o quando a sessão estiver
disponível e sempre trate o `catch`.

### React (inclusive Next.js)

- Componente cliente (`'use client'` no Next), montado no layout do app
  autenticado.
- Um `useEffect` com guarda no escopo do módulo (ou contador de referências),
  para o StrictMode não montar dois widgets nem destruir na primeira limpeza.
- O cleanup remove **só os listeners deste componente**; `destroy()` fica para
  o logout.
- Exponha um contexto/hook (`useBravophone()`) devolvendo `{ pronto, api, erro }`,
  para as telas fazerem click-to-call sem tocar em `window`.

### Vue 3 (inclusive Nuxt)

- Um composable `useBravophone()` com estado no escopo do módulo (singleton),
  `onMounted` para carregar, `onBeforeUnmount` só para os listeners.
- Ou um plugin (`app.use`) que injeta a instância — no Nuxt, plugin
  `*.client.ts`, nunca universal.

### Angular

- Um `@Injectable({ providedIn: 'root' })` guardando a `Promise` do loader.
- `runOutsideAngular` ao carregar e `NgZone.run` ao propagar eventos, para não
  disparar change detection a cada evento de chamada.

### Svelte / SvelteKit

- `onMount` (só roda no cliente) num layout autenticado; store para o estado.

### Regra comum a todas

Carregue **depois** que a sessão existir e fora do caminho crítico de render —
`requestIdleCallback` quando houver, `setTimeout(…, 0)` como alternativa. O
usuário não deve esperar o webphone para ver a tela.

## Click-to-call, o padrão que eu vou querer

```js
document.querySelectorAll('[data-fone]').forEach((el) => {
  el.addEventListener('click', () => {
    Bravophone.call(el.dataset.fone, {
      name: el.dataset.nome,
      crm: el.dataset.empresa,
      gateway: 'nome-do-sistema',   // identifica a origem nos relatórios
    }).catch((e) => console.error('não foi possível ligar:', e.message))
  })
})
```

Em React/Vue/Angular, entregue o equivalente idiomático da stack — sem
`querySelectorAll` manual, usando o handler do componente.

## Entregue

1. O módulo do loader, isolado e reutilizável.
2. A integração no ponto certo da árvore de {{STACK}}, com a sessão vinda de
   {{ONDE_A_SESSAO_VEM}}.
3. Tratamento de erro visível no console em todos os caminhos (`fetch`,
   `onerror`, `call().catch`).
4. Um exemplo de click-to-call e um de escuta de `call:incoming`.
5. Se houver CSP no projeto, o diff da diretiva.

## Critérios de aceite (confira antes de dizer que terminou)

- [ ] `Bravophone.version` no console bate com o `version` de
      `https://data.jsdelivr.com/v1/packages/npm/@bravophone/webphone/resolved`.
- [ ] Nenhuma `<script src>` do Bravophone no HTML servido — o SDK entra só por
      injeção assíncrona.
- [ ] Nenhuma URL de CDN sem versão no código final.
- [ ] Navegar entre telas e voltar não cria um segundo widget; em React
      StrictMode, idem.
- [ ] Sem sessão, nada quebra: a página funciona e o console explica.
- [ ] Com o CDN bloqueado (simule offline), a aplicação continua de pé.
- [ ] Nenhum token ou senha SIP em código versionado.

## Se algo não funcionar, diagnostique nesta ordem

1. `window.Bravophone` existe? Se não, o script não carregou — rede, CSP ou
   bloqueador.
2. O evento `ready` disparou? Se não, a ponte não conectou.
3. `state` veio `'error'`? É registro SIP: token inválido, `extension`
   faltando, ou a origem fora da allowlist de CORS dos backends.
4. Erros do webphone aparecem no console **de dentro do iframe** — troque o
   contexto do console nas devtools.

---
