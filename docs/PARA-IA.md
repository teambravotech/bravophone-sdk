# Bravophone Webphone SDK — contexto para agentes

Você vai integrar o webphone BRAVOPHONE numa página web. Este documento é a
referência completa: **não invente métodos, eventos ou opções que não estejam
aqui.** Se algo que o usuário pede não existir na API, diga isso em vez de
supor um nome plausível.

Pacote: `@bravophone/webphone` · versão atual `0.2.0` · só browser, sem
dependências.

---

## Integração mínima que funciona

```html
<script src="https://cdn.jsdelivr.net/npm/@bravophone/webphone@0.2"></script>
<script>
  Bravophone.init({ token: TOKEN_DO_USUARIO, mode: 'srcdoc' })
</script>
```

Via npm: `import Bravophone from '@bravophone/webphone'` (default export; não
há named export).

O UMD expõe `window.Bravophone`. **Não** use `Bravophone.default`.

---

## As sete coisas que mais dão errado

1. **A página precisa ser HTTPS ou localhost.** `getUserMedia` não existe fora
   de contexto seguro; o webphone carrega e nunca captura áudio. O SDK avisa no
   console, não lança.
2. **O token vem do backend do integrador, por usuário.** Nunca escreva um
   token literal no HTML de exemplo — use um placeholder e diga que ele deve
   ser injetado no template.
3. **`mute()` e `hold()` não aceitam argumento.** São *toggle*. `mute(true)`
   não faz o que parece: o argumento é ignorado.
4. **`call()` devolve Promise e pode rejeitar** (número inválido, webphone
   ainda carregando). Sempre encadeie `.catch()` — sem ele, o clique do usuário
   falha em silêncio.
5. **`init()` é idempotente.** Chamar de novo devolve a mesma instância e
   ignora as novas opções. Para trocar de configuração: `destroy()` e `init()`.
6. **Não existe `call:failed`.** Uma chamada que não completa chega como
   `call:ended`.
7. **O widget vive em Shadow DOM.** `document.querySelector('.bp-root')` não
   encontra nada, e o CSS da página não alcança o widget. Não tente estilizar
   por fora: use as opções de `init()`.

---

## `Bravophone.init(options)`

Chame uma vez, com o `<body>` já existindo. Devolve a instância.

| Opção | Tipo | Padrão | Observação |
|---|---|---|---|
| `token` | `string` | — | Sessão do usuário, emitida pelo backend do integrador |
| `mode` | `'hosted' \| 'srcdoc'` | `'hosted'` | Ver abaixo — quase sempre `'srcdoc'` |
| `hostBase` | `string` | CDN desta versão | Só em `srcdoc`. Deve terminar em `/` |
| `hostUrl` | `string` | domínio oficial | Só em `hosted` |
| `frame` | `'bar' \| 'none'` | `'bar'` | `'none'` = sem barra de título |
| `position` | `'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left'` | `'bottom-right'` | Canto inicial |
| `open` | `boolean` | `false` | `false` = começa recolhido na aba |
| `launcher` | `boolean` | `true` | Exibir a aba lateral |
| `launcherSide` | `'right' \| 'left'` | `'right'` | Borda em que a aba cola |
| `launcherIcon` | `'phone-waves' \| 'waveform' \| 'headset' \| 'chat-phone'` | `'phone-waves'` | |
| `dockTop` | `'max' \| 'top-half'` | `'max'` | O que arrastar até o topo faz |
| `title` | `string` | `'BRAVOPHONE'` | Só com `frame: 'bar'` |

### `mode`: escolha entre os dois

- **`'srcdoc'`** — o iframe roda na origem da própria página e busca o webphone
  no CDN. Sem iframe de terceiro, sem storage particionado. **Exige que a
  origem do site esteja na allowlist de CORS dos backends do Bravophone.**
- **`'hosted'`** — o iframe navega para o domínio do Bravophone. Origem fixa,
  então o CORS não precisa conhecer o integrador. É iframe de terceiro: sujeito
  a bloqueadores e a storage particionado (o login não atravessa domínios).

Recomende `'srcdoc'` quando a origem já estiver liberada no CORS; caso
contrário `'hosted'`.

---

## Métodos

Todos os de telefonia devolvem `Promise`.

### Telefonia

| Método | Retorno | Notas |
|---|---|---|
| `call(number, meta?)` | `Promise<{ok, phone}>` | Número em formato livre |
| `answer()` | `Promise<{ok}>` | Atende a chamada entrante |
| `hangup()` | `Promise<{ok}>` | Encerra a chamada atual |
| `mute()` | `Promise<{ok}>` | **Toggle**, sem argumento |
| `hold()` | `Promise<{ok}>` | **Toggle**, sem argumento |
| `sendDTMF(tone)` | `Promise<{ok}>` | Um caractere: `'0'`–`'9'`, `'*'`, `'#'` |
| `transfer(to)` | `Promise<{ok}>` | Ramal ou número de destino |
| `getStatus()` | `Promise<PhoneStatus>` | Ver formato abaixo |
| `setAuth(token)` | `Promise<{ok}>` | Troca a sessão sem recarregar |
| `logout()` | `Promise<{ok}>` | Encerra a sessão |

`meta` de `call()` — todos opcionais, alimentam o card da chamada e os
relatórios: `{ name, crm, photo, gateway, dealId, url }`.

`PhoneStatus`: `{ ready, inCall, phase, number, incoming, muted, held }`.

### Janela

`show()` · `hide()` · `toggle()` · `reveal()` · `minimize(force?)` ·
`move(x, y)` · `resize(w, h)` · `dock(zone)` · `destroy()`

- `reveal()` — abre se fechada; se já aberta, traz para a vista e destaca. É o
  que a aba lateral chama ao ser clicada.
- `dock(zone)` — `'left'`, `'right'`, `'left-half'`, `'right-half'`,
  `'top-half'`, `'bottom-half'`, `'top'`, `'bottom'`, `'max'`, `'float'`.

### Aba lateral

`setLauncherSide('right' | 'left')` · `setLauncherIcon(nome)`

### Propriedades

`Bravophone.version` · `Bravophone.isOpen` · `Bravophone.geometry`
(`{x, y, width, height, dock}` ou `null` antes do `init`).

---

## Eventos

```js
const off = Bravophone.on('call:incoming', (payload) => { … })
off()                     // remove
Bravophone.off(evt, fn)   // equivalente
```

| Evento | Payload | Quando |
|---|---|---|
| `ready` | `{ version }` | A ponte conectou; o webphone pode receber comandos |
| `state` | `{ state }` | `'connecting'`, `'ready'`, `'error'` |
| `call:dialing` | `CallInfo` | Chamada de saída iniciada |
| `call:incoming` | `CallInfo` | Chamada entrante — a janela se abre sozinha |
| `call:answered` | `CallInfo` | Chamada atendida (entrante ou saída) |
| `call:ended` | `CallInfo` | Encerrada — **inclui as que falharam** |
| `resize` | `{ width, height, dock }` | Janela redimensionada ou encaixada |
| `open` / `close` | — | Janela exibida ou recolhida |
| `reveal` | — | `reveal()` foi chamado |
| `error` | `{ message }` | Falha na ponte ou no carregamento |

`CallInfo`: `{ id, number, direction }` — `direction` é `'inbound'` ou
`'outbound'`.

Use `on('*', ({ event, payload }) => …)` para todos. Bom para depurar; evite
deixar em produção.

---

## Padrão: click-to-call numa lista

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

## Padrão: carregar por JavaScript

Quando não há como escrever a `<script>` no HTML (SPA, Tag Manager):

```js
function carregarBravophone() {
  if (window.Bravophone) return Promise.resolve(window.Bravophone)
  if (window.__bpCarregando) return window.__bpCarregando
  window.__bpCarregando = new Promise((resolve, reject) => {
    const s = document.createElement('script')
    s.src = 'https://cdn.jsdelivr.net/npm/@bravophone/webphone@0.2'
    s.async = true
    s.onload = () => window.Bravophone
      ? resolve(window.Bravophone)
      : reject(new Error('script carregou mas a API não apareceu'))
    s.onerror = () => reject(new Error('falha ao carregar (rede, bloqueador ou CSP)'))
    document.head.appendChild(s)
  })
  return window.__bpCarregando
}
```

Trate sempre o `onerror`: bloqueador de conteúdo e CSP são causas reais, e sem
tratamento o botão de ligar simplesmente não faz nada.

---

## Requisitos da página hospedeira

- **HTTPS** (ou `localhost`).
- Se houver CSP, liberar `cdn.jsdelivr.net` em `script-src`, `style-src` e
  `font-src`. A maioria dos sites não tem CSP restritivo.
- O usuário concede o microfone **uma vez, para a origem do integrador** — não
  para o Bravophone. É consequência do modo `srcdoc`.

## Ao diagnosticar um problema

1. `window.Bravophone` existe? Se não, o script não carregou — veja rede, CSP,
   bloqueador.
2. O evento `ready` disparou? Se não, a ponte não conectou.
3. `state` veio `'error'`? Então é registro SIP: token inválido, ou a origem
   fora da allowlist de CORS dos backends.
4. Erros do webphone aparecem no console **de dentro do iframe** — nas
   devtools, troque o contexto do console.
