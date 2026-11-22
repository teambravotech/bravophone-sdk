# @bravophone/webphone — o SDK embutível (instruções para sessões de Claude)

O webphone BCVOZ embutível em qualquer página: uma janela flutuante arrastável
com o softphone inteiro dentro. Versão atual no `package.json`.

**Leia [`CONTRATOS.md`](CONTRATOS.md) antes de qualquer coisa.** É a descrição
das sete costuras entre as pontas do produto, e este repositório é o dono dela.
As regras da máquina estão em `/root/.claude/CLAUDE.md`.

## A regra que mais se quebra aqui

**Este repositório não é a fonte do webphone.** A extensão
(`/opt/bravophone-extension`) é. O `host/` daqui é **gerado** por
`scripts/sync-from-extension.mjs`, e o cabeçalho dele diz: *"nada é editado
aqui"*.

Mexer no comportamento do softphone → mexer na extensão, buildar lá, e rodar
`npm run sync` aqui. Editar `host/` à mão é trabalho que o próximo `sync` apaga
sem avisar.

O que **é** deste repositório: a janela (`widget.js`, `draggable.js`), a aba de
abertura (`launcher.js`), a ponte (`bridge.js`), o acompanhamento de ramal
(`ramal.js`), o modo `srcdoc` (`srcdoc.js`) e os tipos públicos
(`types/index.d.ts`).

## Antes de publicar

```
npm test          # 18 smokes: shim, geometry, launcher, sessao, teclado, campo,
                  # presenca, acoes, audio, janela, tema, modo-dev, qualidade,
                  # reconectar, sem-microfone, saida, package, popup-html
npm run build
```

O `npm run build:host` roda o `sync` antes — ele **sobrescreve `host/`**. Não o
use achando que é só um build.

Os assets ficam na **raiz** de `host/` de propósito: o bundle resolve
`/fonts/Audiowide-Regular.ttf` e `/fonts/Seguiemj.ttf` a partir da raiz. Servir
sob subdiretório dá 404 nas duas fontes, e a marca muda de aparência **depois do
login** — que é onde a Audiowide aparece. Se alguém reclamar que "a fonte mudou",
é isto.

## Os tipos públicos são o contrato

`types/index.d.ts` é lido por integrador de fora. Os comentários dele explicam
**por que** cada opção existe — ao mudar um comportamento, mude o comentário no
mesmo commit, senão o próximo a ler acredita no antigo.

Duas coisas que o tipo documenta e que todo cliente novo erra:

- `token` sozinho **não basta** para registrar. É preciso a sessão inteira, com
  `extension{username,password}`. Costura 1 do `CONTRATOS.md`.
- `mute()` e `hold()` são **toggle**, não `set`.

## Dívida conhecida

`types/index.d.ts` tem **dois** blocos de comentário para `frame` (um diz que o
padrão é `'none'`, o outro `'bar'`) e `reveal()`/`isOpen` aparecem duplicados nas
interfaces. Isso não quebra a compilação, mas um dos dois comentários de `frame`
está errado. Confira no código antes de responder qual é o padrão — não repita
o comentário.
