# Contratos entre as pontas do BCVOZ

As seis frentes do produto se tocam em **sete costuras**. Este arquivo é a
descrição delas, e mora aqui porque o SDK é o que todos os clientes consomem.

Regra de uso: cada afirmação abaixo foi conferida contra o arquivo citado em
22/11/2026. O que não deu para conferir está marcado **⚠ A CONFIRMAR** — não
apague a marca sem rodar a conferência, e não a trate como fato.

As pontas:

```
  landing page ─┐
                ├─> painel / report (REST) ──> banco
  extensão ─────┤          │
      │         │          └──> Bravo Central (provisionamento, SQL)
      │ (gera)  │
      v         │
     SDK ───────┤
      │         │
  Electron, iOS, Android, webphone embutido
      │
      └──────────── SIP/WSS, direto na borda (NÃO passa pelo painel)
```

---

## 1. Login de sessão — painel → qualquer cliente

`POST /api/voxfree/login` (ver `src/index.js:30`). A resposta é repassada
**inteira** ao webphone; o tipo é `BravophoneSession` em `types/index.d.ts`.

| campo | obrigatório | para quê |
| --- | --- | --- |
| `vxToken` | sim | a sessão |
| `expiresIn` | não | segundos; vira `bravophoneVxTokenExpiresAt` |
| `sip`, `tenant`, `ramal`, `clienteId` | sim, na prática | sem `sip` e `ramal` o webphone **carrega e não registra** |
| `extension{username,password,server?,authID?,displayName?}` | sim | a credencial SIP |
| `ramaisUrl` | não | — |

**A armadilha principal desta costura:** o `checkToken` do webphone exige as
**duas metades** — o `vxToken` *e* um `extension` com `username` e `password`.
Mandar só o token (a opção `token`, atalho para `{vxToken}`) deixa o app parado
na tela de login, e o RouteSelector responde "faça login pelo webphone". Todo
cliente novo erra aqui primeiro.

**Onde a credencial SIP pode estar:** o SDK a envia **apenas** pela ponte
(`postMessage`) e a aplica no store em memória do webphone. Ela não entra no HTML
do iframe nem no `localStorage`. Um cliente novo (Electron, iOS, Android) **não
deve** persistir `extension.password` em disco claro — não há motivo técnico para
isso, já que a sessão é renovável pelo login.

Companheiras: `/api/voxfree/profile` e `/api/voxfree/logout` (usadas pela
extensão).

## 2. Ramal vivo — painel → cliente

`GET /api/pabx/extension` (ver `src/ramal.js:5`), sob a `apiBase` que o
integrador passa (ex.: `https://pabx.teambravotech.com`).

Com `apiBase`, o cliente **reage** a ramal atribuído ou trocado no painel sem
novo login. Sem ela, o estado é o do momento do login e só muda em outro login.

O resultado chega ao integrador no evento `extension`, cujo `reason` é um enum
fechado: `ok`, `no_extension_assigned`, `extension_invalid`,
`relogin_required`, `credentials_not_available`. **Trate os cinco.** Um cliente
que só olha `hasExtension` não sabe distinguir "não tem ramal" de "a sessão
venceu", e manda a pessoa fazer login quando o problema era o painel.

## 3. Troncos e rota de saída — painel → cliente

`GET /api/trunks` e `/api/ramais` (na extensão). No SDK:
`getRoutes()` → `{routes, selected, prefix}` e `setRoute(id)`.

A rota decide **por qual provedora a ligação sai**, e o `prefix` dela é somado
ao destino do INVITE. Um cliente que ignora o prefixo disca para o lugar errado
sem erro visível.

## 4. A ponte SDK ↔ webphone — `postMessage`

Protocolo `bravophone/v1` (`src/bridge.js:8`). Formato do comando:

```js
{ protocol: 'bravophone/v1', type: 'command', id, command, payload }
```

**Comandos** (`BravophoneAPI` em `types/index.d.ts`): `call(number, meta?)`,
`hangup`, `answer`, `mute`, `hold`, `sendDTMF(tone)`, `transfer(to)`,
`getStatus`, `setDial(number)`, `clearDial`, `getRoutes`, `setRoute(id)`,
`setAuth(session)`, `logout`.

`mute` e `hold` são **toggle**, não `set` — o bundle não aceita estado alvo.
Um cliente que trata como `set` dessincroniza o botão.

**Eventos** (`BravophoneEvents`): `ready`, `state`, `call:incoming`,
`call:dialing`, `call:answered`, `call:ended`, `resize`, `extension`, `open`,
`close`, `reveal`, `error`.

## 5. A extensão gera o SDK — não o contrário

`scripts/sync-from-extension.mjs`, primeira linha do cabeçalho: *"A extensão é a
FONTE DA VERDADE do webphone: nada é editado aqui."*

Mexeu no webphone? Mexe em `/opt/bravophone-extension`, builda lá, e roda
`npm run sync` aqui. Editar `host/` à mão é trabalho que o próximo `sync`
apaga.

Os assets vão para a **raiz** de `host/` de propósito: o bundle foi buildado com
`__webpack_public_path__ = "/"` e resolve `/fonts/Audiowide-Regular.ttf` e
`/fonts/Seguiemj.ttf` a partir da raiz do site. Servir sob um subdiretório dá 404
nessas duas fontes e o navegador cai no fallback — a marca e os emojis mudam de
aparência **depois do login**, que é onde a Audiowide aparece.

Versão do SDK: `0.9.0` (`package.json`). O `host/` desta release foi
sincronizado da tag **`v2.6.32`** da extensão — e é essa a versão que vai no
pacote, não a do checkout ao lado nem a do `/opt`. **As duas versões não são
amarradas** — nada falha se divergirem, e é por isso que elas divergem.

⚠ **A CONFIRMAR** — qual versão roda em `/opt/bravophone-extension` e na Chrome
Web Store hoje não foi conferido daqui.

Consequência prática na hora de publicar: quem publica decide, naquele
comando, qual versão da extensão chega a todo integrador. O `prepublishOnly`
sincroniza da pasta ao lado **como ela estiver**, inclusive num branch de
trabalho — veja o procedimento em dois passos no README (*Publicar › npm*).

## 6. Carregamento: `hosted` ou `srcdoc` — e o CORS

| modo | o iframe | consequência |
| --- | --- | --- |
| `hosted` (padrão) | navega para `hostUrl` | todos os requests saem de **uma origem fixa**, então o CORS dos backends não cresce com o número de clientes. Mas é iframe de terceiro: sujeito a bloqueador e a storage particionado |
| `srcdoc` | roda na origem do site do integrador, busca os arquivos no CDN | não é iframe de terceiro, sem partição de storage — **mas a origem do integrador precisa estar na allowlist de CORS dos backends**, senão o webphone carrega e não registra |

"Carrega e não registra" tem duas causas distintas (esta e a da costura 1).
Diagnostique qual antes de mexer.

## 7. SIP/WSS — cliente → borda, direto

**O SIP não passa pelo painel.** O `location /central-ws` do vhost do pabx2 foi
removido; só restou o comentário na linha 20 dizendo isso, e ele engana quem lê
a primeira linha. Consequência prática: **reiniciar o backend não derruba
ligação em curso.**

O cliente fala WSS com a borda. Os endereços ficam no `.env` do painel
(`CENTRAL_SIP_HOST=sip.bcvoz.com`, `CENTRAL_SIP_PORTA_WSS`) e chegam ao cliente
pela sessão da costura 1 — não os chumbe no cliente.

Do lado do motor: o tronco da Wavoip **tem de ser TCP** (ela descarta fragmento
UDP, e o INVITE grande chega partido). Codec provado na sala atendida: PCMU; no
aparelho do participante, PCMA.

⚠ **A CONFIRMAR** — nesta costura não foi conferido para este documento: os
parâmetros exatos de registro usados por iOS e Android, e o despertar de ramal
por push (APNs VoIP no iPhone, FCM no Android, Web Push na extensão). O push é a
**ADR-0083, proposta em 09/11/2026 e esperando as contas** — não existe ainda.
Até existir, um cliente móvel em segundo plano **não** toca.

---

## Ao mexer numa destas costuras

1. Atualize este arquivo **no mesmo commit** em que mexer.
2. Diga qual cliente você conferiu de verdade. "Deve funcionar nos outros" não é
   uma conferência, e os clientes móveis não rodam na máquina do servidor.
3. Mudança incompatível: a costura 1 é consumida por cinco clientes
   (webphone, extensão, SDK, Electron, iOS/Android). Nenhum deles tem
   versionamento amarrado ao servidor hoje — então o servidor precisa aceitar o
   formato antigo até você ter certeza de que todos subiram.
