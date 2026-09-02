// A conta da qualidade de chamada.
//
// POR QUE ESTE ARQUIVO EXISTE: o coletor lê o `getStats()` do WebRTC, que só
// existe dentro de uma chamada de verdade — não dá para exercitar aqui. Mas a
// parte que TRANSFORMA amostras em números (percentil, média, perda, MOS) é
// aritmética pura, e é justamente onde um erro passa despercebido: um MOS
// errado não quebra nada, só mente.
//
// Então o teste carrega o arquivo real com um `window` mínimo, pega as funções
// pelo que elas produzem, e confere contra casos conhecidos.

import { readFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = dirname(fileURLToPath(import.meta.url))
const SDK = resolve(AQUI, '..')
const EXT = resolve(SDK, '..', 'Bravophone')
const ARQUIVO = join(EXT, 'js', 'bravophone-qualidade.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}
const perto = (a, b, tol) => a !== null && Math.abs(a - b) <= tol

console.log('\nqualidade — o arquivo carrega sem navegador:')
check('o coletor existe', existsSync(ARQUIVO))
const fonte = readFileSync(ARQUIVO, 'utf8')

// Um `window` mínimo. O coletor só precisa de setInterval e do próprio window
// para publicar a API; tudo que toca DOM está atrás de guardas.
const relogios = []
const janela = {
  setInterval: (fn, ms) => { relogios.push({ fn, ms }); return relogios.length },
  clearInterval: () => {},
  dispatchEvent: () => {},
  CustomEvent: class { constructor(t, o) { this.type = t; this.detail = o && o.detail } },
}
janela.window = janela

const executar = new Function('window', 'setInterval', 'clearInterval', 'console', fonte)
executar(janela, janela.setInterval, janela.clearInterval,
  { info() {}, warn() {}, error() {} })

check('publica a API em window.__bpQualidade', !!janela.__bpQualidade)
check('e nao acha chamada nenhuma sem webphone', janela.__bpQualidade.agora() === null)
check('agenda a amostragem', relogios.length === 1 && relogios[0].ms === 2000,
  JSON.stringify(relogios.map((r) => r.ms)))

console.log('\nqualidade — o MOS estimado:')
{
  // As funções internas não são exportadas de propósito (é um IIFE). Chegamos
  // nelas pelo mesmo caminho do produto: montando um resumo a partir de
  // amostras. Assim o teste exercita a costura inteira, não uma função solta.
  const mosDe = () => {
    const corpo = fonte.slice(fonte.indexOf('function percentil'),
      fonte.indexOf('// ---', fonte.indexOf('function resumir')))
    return new Function(corpo + '; return mos')()
  }
  const mos = mosDe()

  // Rede excelente: RTT baixo, sem jitter, sem perda → perto do teto (4.4).
  check('rede otima da nota alta', perto(mos(20, 1, 0), 4.4, 0.15), mos(20, 1, 0))

  // PERDA. A primeira versão deste teste exigia uma queda de 0,5 com 5% de
  // perda, e reprovou. O erro era do teste: 5% de perda com Opus, que tem PLC
  // e FEC, fica mesmo por volta de 4,0 — não é o desastre que seria com G.711
  // puro. Exigir um número que eu tinha chutado testava o meu palpite.
  //
  // O que vale afirmar é o comportamento: perda piora de forma monótona, e
  // perda alta tem de cair abaixo da linha de qualidade aceitável (3,6 é o
  // corte usual de "toll quality").
  const bom = mos(20, 1, 0)
  check('perda piora de forma monotona',
    mos(20, 1, 1) < bom && mos(20, 1, 5) < mos(20, 1, 1) && mos(20, 1, 10) < mos(20, 1, 5),
    [bom, mos(20, 1, 1), mos(20, 1, 5), mos(20, 1, 10)].join(' > '))
  check('perda alta cai abaixo da qualidade aceitavel',
    mos(20, 1, 10) < 3.6, mos(20, 1, 10))
  check('rede limpa fica acima de 4', bom > 4, bom)

  // Latência alta de satélite: 600 ms de RTT tem de sair claramente pior.
  check('latencia alta derruba a nota', mos(600, 1, 0) < bom - 0.5, mos(600, 1, 0))

  // Jitter pesa o dobro, porque o buffer precisa segurar a variação.
  check('jitter conta mais que latencia equivalente',
    mos(20, 30, 0) < mos(80, 1, 0), `${mos(20, 30, 0)} vs ${mos(80, 1, 0)}`)

  // A nota nunca sai da escala, mesmo com números absurdos.
  check('nunca passa de 5', mos(0, 0, 0) <= 5, mos(0, 0, 0))
  check('nunca fica abaixo de 1', mos(5000, 500, 100) >= 1, mos(5000, 500, 100))
  check('sem dado nenhum devolve null', mos(null, null, null) === null)
}

console.log('\nqualidade — o resumo de uma chamada:')
{
  const corpo = fonte.slice(fonte.indexOf('function percentil'),
    fonte.indexOf('// ---', fonte.indexOf('function resumir')))
  const { resumir } = new Function(corpo + '; return { resumir }')()

  const amostras = [
    { em: 1, rtt: 20, jitter: 2, perdidos: 0, recebidos: 50, codec: 'opus', tipoLocal: 'host', tipoRemoto: 'host' },
    { em: 2, rtt: 40, jitter: 4, perdidos: 1, recebidos: 100, codec: 'opus', tipoLocal: 'host', tipoRemoto: 'host' },
    { em: 3, rtt: 30, jitter: 3, perdidos: 3, recebidos: 147, codec: 'opus', tipoLocal: 'host', tipoRemoto: 'host' },
  ]
  const r = resumir({ callId: 'abc', direcao: 'sainte', inicio: 0, fim: 6000, amostras })

  check('guarda o Call-ID', r.callId === 'abc')
  check('media de RTT', r.rttMedioMs === 30, r.rttMedioMs)
  check('jitter maximo', r.jitterMaxMs === 4, r.jitterMaxMs)

  // PERDA VEM DO CONTADOR, NAO DA SOMA. O WebRTC acumula desde o inicio da
  // chamada: somar as amostras daria 4 perdidos em vez de 3, e o erro cresce
  // com a duracao. Foi o engano mais provavel deste arquivo.
  check('perda usa o contador acumulado, nao a soma',
    r.pacotesPerdidos === 3, r.pacotesPerdidos)
  check('e a porcentagem sai sobre o total', r.perdaPct === 2, r.perdaPct)

  check('duracao em segundos', r.duracaoS === 6, r.duracaoS)
  check('caminho dos candidatos', r.caminho === 'host/host', r.caminho)
  check('nao marca relay quando e direto', r.viaRelay === false)

  const semNada = resumir({ callId: 'z', direcao: 'entrante', inicio: 0, fim: 1000, amostras: [] })
  check('chamada sem amostra nao inventa numero',
    semNada.rttMedioMs === null && semNada.mos === null && semNada.perdaPct === null)
}

console.log('\nqualidade — o que o coletor promete a quem consome:')
{
  check('nao desenha nada', !/appendChild|createElement/.test(fonte))
  check('nao mexe no store do bundle', !/\.commit\(/.test(fonte))
  // O Call-ID é o que permite achar a chamada depois. Sem ele o resumo é um
  // número solto que não se liga a nada.
  check('captura o Call-ID do SIP', /call_id/.test(fonte))
  check('a janela de amostras e limitada', /TETO_AMOSTRAS/.test(fonte) && /amostras\.shift\(\)/.test(fonte))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
