// O tema claro não pode ter mexido no escuro.
//
// POR QUE ESTE ARQUIVO EXISTE: o tema claro foi feito trocando os VALORES dos
// tokens, não as regras. Isso é ótimo — o `dark-theme.css` segue intacto — mas
// cria duas maneiras silenciosas de estragar tudo:
//
//   1. Um `var(--token, fallback)` cujo fallback não bate com o valor em
//      `:root`. O fallback só aparece se o CSS não carregar, então a
//      divergência fica invisível até o dia em que ele não carrega — e aí o
//      escuro sai com a cor errada, sem ninguém ter mudado nada.
//
//   2. Um token sem valor no bloco claro. Ele herda o valor escuro, e no tema
//      claro nasce uma ilha preta no meio de uma tela branca. É o defeito mais
//      comum de tema claro feito por cima de tema escuro.
//
// Os dois são invisíveis em revisão de código e óbvios para quem usa.

import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = resolve(SDK, '..', 'Bravophone')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

const norma = (s) => String(s).replace(/\s+/g, '').toLowerCase()

/** Lê os tokens de um bloco de seletor específico. */
function tokensDo(css, seletor) {
  const mapa = {}
  const re = new RegExp(seletor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}', 'g')
  let bloco
  while ((bloco = re.exec(css))) {
    const decl = /(--bp-[a-z0-9-]+)\s*:\s*([^;]+);/g
    let m
    while ((m = decl.exec(bloco[1]))) mapa[m[1]] = m[2].trim()
  }
  return mapa
}

const escuroCss = readFileSync(join(EXT, 'css', 'dark-theme.css'), 'utf8')
const claroCss = readFileSync(join(EXT, 'css', 'tema-claro.css'), 'utf8')

// O `:root` puro dos dois arquivos é o tema escuro.
const escuro = { ...tokensDo(escuroCss, ':root'), ...tokensDo(claroCss, ':root') }
const claro = tokensDo(claroCss, ':root[data-bp-tema="claro"]')

console.log('\ntema — o escuro segue intocado:')
{
  // A prova mais direta: o arquivo do escuro não conhece o atributo do tema.
  // Se alguém for "ajustar o claro" mexendo lá, isto acusa.
  check('dark-theme.css não menciona data-bp-tema',
    !/data-bp-tema/.test(escuroCss))
  check('dark-theme.css continua com o :root original',
    /--bp-bg:\s*#10131c/.test(escuroCss) && /--bp-panel:\s*#171b28/.test(escuroCss))
  check('o claro só age sob o atributo',
    (claroCss.match(/^\s*#app\s/gm) || []).length === 0,
    'há regra do claro fora de :root[data-bp-tema]')
}

console.log('\ntema — todo fallback bate com o :root:')
{
  const fontes = []
  for (const raiz of [join(EXT, 'js'), join(SDK, 'host', 'js')]) {
    if (!existsSync(raiz)) continue
    for (const f of readdirSync(raiz).filter((n) => /^bravophone-.*\.js$/.test(n))) {
      fontes.push([raiz === join(EXT, 'js') ? 'extensão' : 'sdk', f, join(raiz, f)])
    }
  }
  check('achei os scripts injetados', fontes.length > 0, fontes.length)

  // Casa `var(--token, valor)` mesmo quando o valor é um rgba() com os
  // próprios parênteses.
  const reVar = new RegExp(String.raw`var\(\s*(--bp-[a-z0-9-]+)\s*,\s*((?:[^()]|\([^()]*\))*)\)`, 'g')

  const divergentes = []
  let conferidos = 0
  for (const [onde, nome, caminho] of fontes) {
    const texto = readFileSync(caminho, 'utf8')
    let m
    reVar.lastIndex = 0
    while ((m = reVar.exec(texto))) {
      const [, token, fallback] = m
      // Tokens de layout (largura, altura) são calculados em tempo de
      // execução e não têm valor fixo em :root. Só cores nos interessam.
      if (!(token in escuro)) continue
      conferidos++
      if (norma(escuro[token]) !== norma(fallback)) {
        divergentes.push(`${onde}/${nome}: ${token} = ${escuro[token]} mas fallback ${fallback}`)
      }
    }
  }
  check(`${conferidos} usos conferidos`, conferidos > 40, conferidos)
  check('nenhum fallback diverge do escuro',
    divergentes.length === 0, divergentes.join(' | '))
}

console.log('\ntema — o claro cobre todos os tokens:')
{
  // Um token sem valor claro herda o escuro e vira uma mancha preta na tela
  // branca. Estes ficam de fora porque são cor de marca ou de sistema, iguais
  // nos dois temas de propósito.
  const IGUAIS_NOS_DOIS = new Set(['--bp-verde-zap', '--bp-branco', '--bp-preto-zap'])

  const semClaro = Object.keys(escuro)
    .filter((t) => !IGUAIS_NOS_DOIS.has(t))
    .filter((t) => !(t in claro))

  check('todo token de cor tem valor claro', semClaro.length === 0, semClaro.join(', '))
  check('o bloco claro não inventa token que o escuro não tem',
    Object.keys(claro).every((t) => t in escuro),
    Object.keys(claro).filter((t) => !(t in escuro)).join(', '))
}

console.log('\ntema — a ordem de carga evita o piscar:')
{
  const html = readFileSync(join(EXT, 'popup.html'), 'utf8')
  const iEscuro = html.indexOf('dark-theme.css')
  const iClaro = html.indexOf('tema-claro.css')
  check('tema-claro.css carrega depois do dark-theme.css',
    iEscuro >= 0 && iClaro > iEscuro, `${iEscuro} vs ${iClaro}`)

  // Sem isto a janela abre escura e clareia depois — em toda abertura.
  const tag = (html.match(/<script[^>]*bravophone-tema\.js[^>]*>/) || [''])[0]
  check('o script do tema está no popup.html', !!tag, tag)
  check('e roda sem defer (antes do primeiro quadro)', !!tag && !/defer/.test(tag), tag)
  check('e antes do popup.js',
    html.indexOf('bravophone-tema.js') < html.indexOf('/popup.js'))
}

console.log('\ntema — o controle não entra na árvore do Vue:')
{
  const js = readFileSync(join(EXT, 'js', 'bravophone-tema.js'), 'utf8')
  // Este projeto já entrou em ciclo de recarga duas vezes por inserir nó no
  // que o Vue desenha: o componente é desmontado e o `unmounted` do webphone
  // chama location.reload().
  check('anexa no body, não no #app',
    /document\.body\.appendChild/.test(js) &&
    !/#app['"]\s*\)\s*\.appendChild/.test(js))
  check('não usa insertBefore em nó do bundle', !/insertBefore/.test(js))
  check('reposiciona quando a aba muda', /MutationObserver/.test(js))

  check('os três estados existem',
    /sistema/.test(js) && /claro/.test(js) && /escuro/.test(js))
  // Sem matchMedia o padrão tem de cair no escuro, que é o que todo mundo
  // já tem — nunca no claro.
  check('sem matchMedia, cai no escuro',
    /if \(!window\.matchMedia\) return false/.test(js))
}
console.log('\ntema — quem embrulha o webphone fica sabendo:')
{
  const js = readFileSync(join(EXT, 'js', 'bravophone-tema.js'), 'utf8')

  // O evento nasceu avisando só TROCA. Quem abrisse já no claro nunca
  // trocava nada, e a moldura do widget do SDK ficava escura em volta de um
  // app claro — sem evento nenhum para corrigir. Só apareceu olhando a tela;
  // nenhum teste de então tinha como pegar, porque cada metade estava certa.
  check('anuncia o tema inicial, e nao so as trocas',
    /anunciarOEstadoAtual\(\)/.test(js) && /function anunciarOEstadoAtual/.test(js))
  check('avisa tambem quando o sistema troca sozinho',
    /aoMudarOSistema[\s\S]{0,260}avisar\(/.test(js))

  const w = readFileSync(join(SDK, 'src', 'widget.js'), 'utf8')
  check('a moldura do widget escuta o evento', /theme:changed/.test(w))
  check('e parte do sistema antes de o iframe responder',
    /prefers-color-scheme: light/.test(w))

  const st = readFileSync(join(SDK, 'src', 'styles.js'), 'utf8')
  // O CSS do widget é um template literal: uma crase dentro de um comentário
  // encerra a string, e o rollup falha com um erro que não menciona crase.
  // Aconteceu ao escrever justamente o comentário destes tokens.
  check('o CSS do widget tem crases equilibradas',
    (st.match(/`/g) || []).length % 2 === 0,
    (st.match(/`/g) || []).length + ' crases')
  check('a moldura tem tokens proprios', /--bpw-bg/.test(st))
}

console.log('\ntema — o que o bundle pinta por estilo inline:')
{
  const css = readFileSync(join(EXT, 'css', 'tema-claro.css'), 'utf8')

  // NÃO MIRAR PELO ATRIBUTO `style`. O Vue aplica pela CSSOM, e o navegador
  // RE-SERIALIZA a declaração: `#12141c` vira `rgb(18, 20, 28)` e o
  // `180deg` do gradiente some. Um seletor [style*="#12141c"] nunca casa no
  // app de verdade.
  //
  // Isso custou uma rodada inteira: o teste de tela que escrevi passava,
  // porque eu tinha escrito o atributo à mão no HTML — o único caso que não
  // acontece em produção. O harness confirmava a minha suposição, não o
  // produto.
  check('a tela de chamada e alcancada pela classe, nao pelo atributo',
    /#app \.call-screen \{/.test(css) &&
    !/call-screen\[style/.test(css))

  // A lista de sugestões é irmã seguinte do nosso campo. O
  // bravophone-input.js já depende dessa relação para escondê-la, então é
  // âncora provada.
  check('as sugestoes sao alcancadas pela estrutura',
    /\.bpi-wrap ~ \.z-20\.shadow-lg \{/.test(css))
  check('o nome do contato', /\.bpi-wrap ~ \.z-20\.shadow-lg \.text-white/.test(css))
  check('e o item sob o ponteiro', /hover\\:bg-gray-800:hover/.test(css))

  // Onde o atributo é INEVITÁVEL — botão ativo e inativo são o mesmo
  // elemento, mesma classe, só a cor inline os separa — usamos a forma
  // serializada, que é definida por especificação e é o que existe no DOM.
  check('os botoes de acao usam a forma serializada',
    /\[style\*="rgb\(28, 33, 49\)"\]/.test(css))
  check('e o botao ativo (verde) fica de fora',
    !/rgb\(22, 163, 74\)/.test(css))

  // Os textos da tela de chamada usam text-gray-*, que o dark-theme.css já
  // mapeia. Duplicar aqui criaria duas fontes para a mesma cor.
  check('nao duplica o que o dark-theme ja mapeia',
    !/call-screen[^{]*\.text-gray-/.test(css))
}


console.log('\ntema — o controle vive enquanto Ajustes esta aberto:')
{
  const js = readFileSync(join(EXT, 'js', 'bravophone-tema.js'), 'utf8')

  // A TROCA DE ABA É MUTAÇÃO DE ATRIBUTO. O Vue usa `v-show`, que mexe em
  // `style.display`. Observando só `childList`, o controle reagia por
  // acidente — quando outra coisa mudava o DOM por perto. Demorava a
  // aparecer ao abrir Ajustes e ficava na tela depois de sair: uma causa,
  // dois sintomas. É o que faz o controle acompanhar a aba nos dois
  // sentidos, e por isso continua aqui mesmo depois de a carência sair.
  check('observa atributos, e nao so filhos',
    /attributes:\s*true/.test(js) && /attributeFilter/.test(js))
  check('e filtra por style, que e o que o v-show mexe',
    /attributeFilter:\s*\['style'/.test(js))

  // Houve uma versão com 2s de folga, trava pelo mouse e transição de
  // saída. Na tela não convenceu: um controle que sobrevive à própria tela
  // parece esquecido, não gentil. Estes casos existem para que essa
  // máquina não volte por engano num refactor.
  check('sem carencia para sumir', !/CARENCIA|relogioSaida/.test(js))
  check('sem trava pelo mouse', !/sobreOControle|mouseenter/.test(js))
  check('sem transicao de saida', !/bp-tema--saindo|transitionend/.test(js))

  // Fora de Ajustes o controle não pode existir na tela — flutuando sobre a
  // tela de chamada ele atrapalharia justamente na hora errada.
  check('esconde quando a aba nao esta a vista',
    /if \(!r\) \{ esconder\(\); return \}/.test(js) && /function esconder/.test(js))
  check('e usa offsetParent, que e como v-show se denuncia',
    /offsetParent === null/.test(js))

  // O controle e uma camada FIXA sobre o rodape do painel: sem reservar o
  // espaco, ele cobre o que estiver no fim da lista — o botao Sair, no
  // limite da rolagem. Aconteceu.
  check('reserva espaco no fim da lista',
    /body.bp-tema-visivel .settings-tab/.test(js) &&
    /padding-bottom:calc\(var\(--bp-tema-altura/.test(js))
  check('mede a altura em vez de chutar', /offsetHeight/.test(js))
  // Sem tirar a classe ao esconder, a aba fica com um vao no fim.
  check('tira a reserva quando o controle some',
    /classList\.remove\('bp-tema-visivel'\)/.test(js))
}


console.log('\ntema — o observador nao pode alimentar a si mesmo:')
{
  const js = readFileSync(join(EXT, 'js', 'bravophone-tema.js'), 'utf8')

  // ISTO JÁ TRAVOU O NAVEGADOR. O observador filtra `style` e `class`, que
  // são exatamente os dois atributos que o posicionamento escreve no
  // `body`. Escrevendo sem conferir, cada passada dispara a seguinte — e
  // com `offsetHeight` no meio, cada volta força cálculo de layout. A aba
  // congela ao entrar numa chamada, que é quando o DOM mais muda.
  //
  // Medido num navegador de verdade: a versão sem guardas nunca devolveu o
  // controle ao Chrome; a versão com guardas faz 2 escritas e para.

  check('a classe do body so e tocada quando o estado vira',
    /function reservarEspaco/.test(js) && /if \(sim === reservado\) return/.test(js))

  check('a geometria so e reescrita quando muda',
    /ultimoLugar/.test(js) && /assinatura !== ultimoLugar/.test(js))

  // Medir layout a cada mutação do documento é caro justamente no meio de
  // uma chamada.
  check('offsetHeight so e lido quando algo pode ter mudado a altura',
    /if \(mudouDeLugar \|\| ultimaAltura === 0\)/.test(js))

  check('as mutacoes sao agrupadas por quadro',
    /function agendar/.test(js) &&
    /new MutationObserver\(agendar\)/.test(js) &&
    /requestAnimationFrame/.test(js))

  // Se alguém trocar o callback de volta para `sincronizar` direto, volta a
  // rodar uma vez por mutação.
  check('o observador nao chama sincronizar direto',
    !/new MutationObserver\(sincronizar\)/.test(js))
}


console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
