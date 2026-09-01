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

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
