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
  const r = resumir({ callId: 'abc', direcao: 'outbound', inicio: 0, fim: 6000, amostras })

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

  const semNada = resumir({ callId: 'z', direcao: 'inbound', inicio: 0, fim: 1000, amostras: [] })
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

console.log('\nqualidade — o vocabulario e o do banco, nao um nosso:')
{
  // `inbound`/`outbound` é o que crm_chamadas.sentido usa. O codid existe
  // para casar as duas tabelas; duas palavras para a mesma coisa viram uma
  // tradução na consulta e um bug de filtro algum dia.
  check('direcao usa inbound/outbound',
    /'inbound' : 'outbound'/.test(fonte) && !/entrante|sainte/.test(fonte))
}

console.log('\nqualidade — a razao do fim:')
{
  // Metade do diagnóstico. Queda por rede não se parece com desligamento
  // normal, e sem isto a linha mostra a chamada ruim sem dizer como terminou.
  check('escuta ended e failed da sessao',
    /sessao\.on\('ended'/.test(fonte) && /sessao\.on\('failed'/.test(fonte))
  // Precisa ser na hora em que a chamada aparece: quando a varredura percebe
  // que a sessão sumiu, a causa já se foi junto.
  check('escuta no inicio, nao no fim',
    fonte.indexOf('escutarOFim(alvo.sessao)') < fonte.indexOf('function encerrar'))
  check('o motivo entra no resumo', /motivoFim: c\.motivoFim/.test(fonte))
  // O JsSIP manda frase, não código. O sip_code do CRM foi criado estreito
  // demais por essa suposição e rejeitava linha.
  check('corta em 190, o tamanho da coluna', /slice\(0, 190\)/.test(fonte))
}

console.log('\nqualidade — o envio guarda antes de mandar:')
{
  const envio = readFileSync(join(EXT, 'js', 'bravophone-qualidade-envio.js'), 'utf8')

  // O resumo sai no fim da chamada — que é exatamente quando a rede pode estar
  // ruim, porque foi a rede ruim que gerou o resumo que vale a pena ler.
  // Enviar e torcer perderia justamente os casos que interessam.
  const ouvinte = envio.slice(envio.indexOf("addEventListener('bp:qualidade'"))
  check('enfileira antes de tentar',
    ouvinte.indexOf('enfileirar(') < ouvinte.indexOf('escoar('),
    ouvinte.slice(0, 120).replace(/\n/g, ' '))
  check('so apaga da fila conforme a politica de status',
    envio.includes("if (apagaDaFila(r.status))"))
  check('a fila tem teto', /TETO_FILA/.test(envio) && /f\.shift\(\)/.test(envio))

  // Resumo sem Call-ID não se liga a chamada nenhuma, e achar depois é o
  // motivo de existir.
  check('recusa resumo sem Call-ID', /if \(!resumo \|\| !resumo\.callId\)/.test(envio))
  // O mesmo Call-ID duas vezes é retry, não chamada nova.
  check('o mesmo Call-ID nao vira duas linhas',
    /f\[i\]\.callId === resumo\.callId/.test(envio))

  // A identidade vem da credencial. O corpo descreve a chamada.
  check('manda o token no header', /'X-Vx-Token': t/.test(envio))
  // O trecho da função que monta o corpo, sem comentários — a primeira versão
  // deste caso reprovou porque casava com a palavra "ramal" dentro do
  // comentário que explica justamente que ramal não vai no corpo.
  const corpo = envio
    .slice(envio.indexOf('function corpoDe'), envio.indexOf('function escoar'))
    .replace(/\/\/[^\n]*/g, '')
  check('nao manda cliente nem ramal no corpo',
    !/cliente|ramal/i.test(corpo), corpo.match(/.{0,40}(cliente|ramal).{0,40}/i))
  check('reusa a identidade da presenca, nao redescobre',
    /__bpPresenca/.test(envio) && !/chrome\.storage/.test(envio))
}

console.log('\nping — a medicao trocada, o indicador mantido:')
{
  const ping = readFileSync(join(EXT, 'js', 'bravophone-ping.js'), 'utf8')

  // Um Image de mentira, para exercitar o envelope sem navegador. O descritor
  // nativo de `src` é o que o envelope delega quando NÃO é o ping.
  const carregadas = []
  class ImagemFalsa {
    constructor() { this.onload = null; this.onerror = null; this._src = null }
  }
  const proto = { }
  Object.defineProperty(proto, 'src', {
    configurable: true,
    get() { return 'ABSOLUTA:' + this._src },
    set(v) { this._src = v; carregadas.push(v) },
  })
  Object.setPrototypeOf(ImagemFalsa.prototype, proto)

  const relogios = []
  const janela = {
    Image: ImagemFalsa,
    HTMLImageElement: { prototype: proto },
    setTimeout: (fn, ms) => { relogios.push({ fn, ms }); return relogios.length },
    fetch: () => Promise.resolve({}),
    __bpQualidade: { emChamada: () => true, agora: () => ({ rttMedioMs: 42 }) },
    __bpPresenca: { apiBase: () => 'https://api.exemplo' },
  }
  janela.window = janela

  new Function('window', 'setTimeout', 'fetch', 'console', ping)(
    janela, janela.setTimeout, janela.fetch, { warn() {}, info() {} })

  check('envolveu o construtor Image', janela.Image !== ImagemFalsa)
  check('publicou a API do ping', !!janela.__bpPing)

  // IMAGEM DE VERDADE PASSA INTACTA. O getter nativo devolve URL absoluta; um
  // getter meu devolvendo o valor cru mudaria o significado de `img.src` para
  // o app inteiro — inclusive para quem compara URL de foto de contato.
  const normal = new janela.Image()
  normal.src = 'https://exemplo.com/foto.png'
  check('imagem normal chega ao caminho nativo',
    carregadas.indexOf('https://exemplo.com/foto.png') >= 0, carregadas.join(','))
  check('e o getter continua devolvendo a URL absoluta',
    normal.src === 'ABSOLUTA:https://exemplo.com/foto.png', normal.src)

  // O PING É RECONHECIDO PELA FORMA, não pelo domínio: trocar o host do
  // favicon é provável; trocar o nome do parâmetro, não.
  const antes = carregadas.length
  const sonda = new janela.Image()
  sonda.src = 'https://app2.voxfree.com.br/x.png?random-no-cache=abc'
  check('o ping nao vira requisicao de imagem', carregadas.length === antes)
  check('reconhece pela forma, nao pelo dominio', /random-no-cache=/.test(ping))
}

console.log('\nping — o que ele promete:')
{
  const ping = readFileSync(join(EXT, 'js', 'bravophone-ping.js'), 'utf8')

  // Em chamada o número já existe, medido pelo navegador sobre o RTP. Fora
  // dela, um pedido de verdade à NOSSA API — host que controlamos, para uma
  // queda nossa não virar toast dizendo ao cliente que a internet dele caiu.
  check('em chamada usa o RTT real', /emChamada\(\)/.test(ping) && /rttMedioMs/.test(ping))
  check('fora dela mede a nossa API', /apiBase\(\)/.test(ping) && /fetch\(/.test(ping))
  check('nao contata mais o host de terceiro', !/voxfree/.test(ping.replace(/\/\*[\s\S]*?\*\//g, '')))

  // O componente marcava offline e mostrava toast vermelho na PRIMEIRA falha.
  // Uma troca de wi-fi virava alarme no meio do expediente.
  check('ha histerese antes de dizer offline', /FALHAS_PARA_OFFLINE = 3/.test(ping))
  check('falha isolada ainda responde ok', /falhasSeguidas < FALHAS_PARA_OFFLINE/.test(ping))

  // Se o descritor nativo não existir, é melhor não envolver nada.
  check('sem descritor nativo, desiste em vez de meio-envolver',
    /sem descritor nativo/.test(ping))
}

console.log('\nqualidade — o que apaga da fila e o que fica:')
{
  const envio = readFileSync(join(EXT, 'js', 'bravophone-qualidade-envio.js'), 'utf8')
  // A função é pura: dá para exercitá-la de verdade em vez de olhar o texto.
  const corpo = envio.slice(envio.indexOf('function apagaDaFila'),
    envio.indexOf('// ---', envio.indexOf('function apagaDaFila')))
  const apaga = new Function(corpo + '; return apagaDaFila')()

  check('2xx entrou, apaga', apaga(200) && apaga(201) && apaga(204))
  // O duplicado vem 200 com { duplicado: true } — reenvio depois de queda de
  // rede não é conflito, é o comportamento esperado.
  check('duplicado tambem e 2xx, apaga', apaga(200))

  // 503 é o estado enquanto o DDL não roda: o corpo está certo, quem não está
  // é o servidor. Insistir depois é o comportamento correto.
  check('503 fica na fila', !apaga(503))
  check('500 e 502 ficam', !apaga(500) && !apaga(502))

  // vxToken válido mas sem ramal na sessão também dá 401.
  check('401 fica (token ainda nao carregou)', !apaga(401))
  check('408 e 429 ficam', !apaga(408) && !apaga(429))

  // Corpo que o servidor nunca vai aceitar: insistir entupiria a fila.
  check('400 apaga', apaga(400))
  check('422 apaga', apaga(422))
  check('404 apaga', apaga(404))
}

console.log('\nqualidade — a chamada que caiu antes de comecar:')
{
  const col = readFileSync(join(EXT, 'js', 'bravophone-qualidade.js'), 'utf8')
  // A versão anterior descartava resumo sem amostra, e era erro: uma chamada
  // que caiu antes da primeira leitura é justamente a mais interessante — não
  // há métrica, mas há o motivoFim, que responde por que ela caiu.
  check('nao descarta resumo sem amostra', !/if \(!r\.amostras\) return/.test(col))

  const corpo = col.slice(col.indexOf('function percentil'),
    col.indexOf('// ---', col.indexOf('function resumir')))
  const { resumir } = new Function(corpo + '; return { resumir }')()
  const r = resumir({
    callId: 'caiu', direcao: 'outbound', inicio: 0, fim: 1500,
    motivoFim: 'remote:Rejected', amostras: [],
  })
  check('e o resumo carrega o motivo', r.motivoFim === 'remote:Rejected', r.motivoFim)
  check('sem inventar metrica', r.mos === null && r.rttMedioMs === null)

  // O filtro que importa é outro: sem Call-ID não há como achar a chamada.
  const envio = readFileSync(join(EXT, 'js', 'bravophone-qualidade-envio.js'), 'utf8')
  check('o filtro real e o Call-ID, no envio',
    /if \(!resumo \|\| !resumo\.callId\)/.test(envio))

  // A CORRECAO ANTERIOR NAO BASTAVA. Eu tinha tirado o descarte no fim, mas
  // o coletor pulava qualquer sessao que ainda nao tivesse estabelecido —
  // entao a chamada recusada, ocupada ou com ramal inexistente nunca era
  // sequer rastreada. Corrigi o sintoma e deixei a causa.
  check('acompanha a chamada antes de ela conectar',
    !col.includes("if (s.isEstablished && !s.isEstablished()) continue"))

  // Separa "chamada ruim" de "chamada que nem completou": sem isto as duas
  // chegam ao banco com metrica nula e viram a mesma coisa na consulta.
  check('o resumo diz se chegou a estabelecer',
    col.includes("estabeleceu: !!c.estabeleceu"))
  check('e o envio leva o campo',
    readFileSync(join(EXT, "js/bravophone-qualidade-envio.js"), "utf8")
      .includes("estabeleceu: resumo.estabeleceu"))
}

console.log('\nqualidade — a base da rota e configuravel:')
{
  const envio = readFileSync(join(EXT, 'js', 'bravophone-qualidade-envio.js'), 'utf8')
  // A rota nasceu em homologação, num vhost próprio; a produção ainda não a
  // tem. Sem a chave, cai na base da presença — que é para onde isto vai
  // quando a rota subir em produção, sem ninguém lembrar de nada.
  check('ha override por localStorage', /bp:qualidade:base/.test(envio))
  check('e o padrao e a base da presenca', /return p\.apiBase\(\)/.test(envio))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
