# Modelo de CLAUDE.md para os clientes que não ficam no servidor

Três repositórios do produto **não** estão clonados na máquina do servidor, então
uma sessão de Claude aberta neles não herda nada do que se aprendeu aqui:

| repositório | o que é |
| --- | --- |
| `teambravotech/bcvoz-desktop` | cliente Electron |
| `teambravotech/bravophone-mobile` | iOS e Android |
| `teambravotech/bravophone-extension` | extensão (esta tem CLAUDE.md próprio, já escrito) |

Copie o texto abaixo para `CLAUDE.md` na raiz de cada um e complete os
`<colchetes>` com o que só se sabe lá dentro (como buildar, como rodar no
simulador, onde ficam as chaves de assinatura).

---

```markdown
# <nome do cliente> — instruções para sessões de Claude

Este é um **cliente** do BCVOZ. Ele não define o contrato com o servidor: só o
consome.

## Antes de mexer em login, registro SIP, ramal ou tronco

Leia `CONTRATOS.md` do repositório `teambravotech/bravophone-sdk`. São as sete
costuras entre as pontas do produto. O que você precisa saber de cabeça:

1. **Login não é só o token.** `POST /api/voxfree/login` devolve `vxToken` *e*
   `extension{username,password}`. O `checkToken` exige as **duas metades** —
   só o token deixa o app parado na tela de login. É o erro nº 1 de todo
   cliente novo.
2. **Não persista `extension.password` em disco claro.** A sessão é renovável
   pelo login; o webphone a mantém em memória de propósito.
3. **O ramal muda sem novo login.** `GET /api/pabx/extension` sob a `apiBase`.
   O motivo são os cinco `reason` possíveis (`ok`, `no_extension_assigned`,
   `extension_invalid`, `relogin_required`, `credentials_not_available`) —
   trate os cinco. Quem só olha "tem ramal?" manda a pessoa relogar quando o
   problema era o painel.
4. **O prefixo do tronco entra no destino do INVITE.** Ignorá-lo disca para o
   lugar errado sem erro visível.
5. **Mudo e espera são toggle, não set.**
6. **O SIP não passa pelo backend.** O cliente fala WSS direto com a borda, e
   os endereços vêm na sessão — não os chumbe aqui.
7. **Push de chamada não existe ainda** (ADR-0083, proposta em 09/11/2026,
   esperando as contas). Até existir, este app em segundo plano **não toca**.
   Se alguém relatar "não recebo ligação com o app fechado", é isto, não defeito.

## Regras do projeto que valem aqui também

- Antes de escrever "porque X" num comentário, rode o comando que prova X.
- Documento deste projeto não é confiável por padrão: confira contra o código.
- Número que veio de relatório ou de outra sessão é hipótese — reexecute a
  medição.

## Deste repositório

- Como buildar: `<comando>`
- Como rodar numa máquina de desenvolvimento: `<comando>`
- Testes: `<comando>`
- Publicar: `<quem publica, e o que ele confere>`
- As armadilhas que já custaram caro aqui: `<complete à medida que doer>`
```
