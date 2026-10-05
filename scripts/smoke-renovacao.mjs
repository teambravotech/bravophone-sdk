// A sessão se mantém viva: o token é renovado antes de vencer.
//
// POR QUE EXISTE: o vxToken vence (expiresIn, tipicamente 3600 s) e nada o
// renovava. Passado esse tempo o bundle julgava a sessão vencida e o login do
// usuário caía no meio do expediente. Este arquivo prende o comportamento do
// src/sessao.js com um relógio falso — uma hora de prazo passa em milissegundos.

import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const { manterSessao, prazoDeRenovacao, esperaEntreTentativas } = await import('../src/sessao.js')

let pass = 0, fail = 0
const check = (nome, cond, extra) => {
  if (cond) { pass++; console.log(`  ✓ ${nome}`) }
  else { fail++; console.log(`  ✗ ${nome}${extra !== undefined ? '  → ' + extra : ''}`) }
}

/** Deixa as promises pendentes andarem. */
const assentar = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setImmediate(r)) }

function relogioFalso() {
  let agora = 0
  let seq = 0
  const timers = new Map()
  return {
    now: () => agora,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, quando: agora + ms }); return id },
    clearTimeout: (id) => { timers.delete(id) },
    pendentes: () => timers.size,
    async avancar(ms) {
      const alvo = agora + ms
      for (;;) {
        const proximo = [...timers.entries()]
          .filter(([, t]) => t.quando <= alvo)
          .sort((a, b) => a[1].quando - b[1].quando)[0]
        if (!proximo) break
        timers.delete(proximo[0])
        agora = proximo[1].quando
        proximo[1].fn()
        await assentar()
      }
      agora = alvo
    },
  }
}

function montar({ renovar, margem, retry } = {}) {
  const relogio = relogioFalso()
  const eventos = []
  const aplicadas = []
  const s = manterSessao({
    renovar,
    aplicar: (nova) => { aplicadas.push(nova); return Promise.resolve({ ok: true }) },
    emitir: (nome, payload) => eventos.push({ nome, payload }),
    relogio,
    margem,
    retry,
  })
  const nomes = () => eventos.map((e) => e.nome)
  return { s, relogio, eventos, nomes, aplicadas }
}

const HORA = { vxToken: 'velho', expiresIn: 3600 }

console.log('\nprazo — quando renovar:')
check('token de 1 h renova aos 55 min', prazoDeRenovacao(3600) === 55 * 60 * 1000, prazoDeRenovacao(3600))
check('token curto renova com 20% de folga', prazoDeRenovacao(120) === 96 * 1000, prazoDeRenovacao(120))
check('sem expiresIn não há prazo', prazoDeRenovacao(undefined) === null)
check('expiresIn zero ou lixo não vira prazo',
  prazoDeRenovacao(0) === null && prazoDeRenovacao('abc') === null)

console.log('\nrenovação — antes de vencer:')
{
  let chamadas = 0
  const t = montar({ renovar: async () => { chamadas++; return { vxToken: 'novo', expiresIn: 3600 } } })
  t.s.programar(HORA)
  await t.relogio.avancar(55 * 60 * 1000 - 1)
  check('não renova antes da hora', chamadas === 0)
  await t.relogio.avancar(1)
  check('renova no prazo', chamadas === 1)
  check('aplica a sessão nova', t.aplicadas[0]?.vxToken === 'novo')
  check('avisa session:renewed', t.nomes().includes('session:renewed'), t.nomes())
  check('e já agenda a próxima', t.relogio.pendentes() === 1)
  await t.relogio.avancar(55 * 60 * 1000)
  check('a sessão nova também é renovada no prazo dela', chamadas === 2)
  check('nunca avisou expiração', !t.nomes().includes('session:expired'))
}

console.log('\nrenovação — o 401 renova na hora:')
{
  let chamadas = 0
  const t = montar({ renovar: async () => { chamadas++; return { vxToken: 'novo', expiresIn: 3600 } } })
  t.s.programar(HORA)
  const ok = await t.s.renovarAgora('401')
  check('renovou sem esperar o prazo', ok === true && chamadas === 1)
  check('o prazo recomeça da sessão nova', t.relogio.pendentes() === 1)
}

console.log('\nrenovação — prazo e 401 juntos viram uma chamada só:')
{
  let chamadas = 0
  let liberar
  const t = montar({ renovar: () => { chamadas++; return new Promise((r) => { liberar = r }) } })
  t.s.programar(HORA)
  const a = t.s.renovarAgora('prazo')
  const b = t.s.renovarAgora('401')
  await assentar()
  liberar({ vxToken: 'novo', expiresIn: 3600 })
  await Promise.all([a, b])
  check('o backend foi chamado uma vez', chamadas === 1, chamadas)
}

console.log('\nfalha — com prazo sobrando, tenta de novo:')
{
  let chamadas = 0
  const t = montar({
    renovar: async () => {
      chamadas++
      if (chamadas === 1) throw new Error('rede caiu')
      return { vxToken: 'novo', expiresIn: 3600 }
    },
  })
  t.s.programar(HORA)
  await t.relogio.avancar(55 * 60 * 1000)
  check('a primeira falha vira erro, não logout',
    t.nomes().includes('error') && !t.nomes().includes('session:expired'), t.nomes())
  await t.relogio.avancar(30 * 1000)
  check('tenta de novo 30 s depois e renova', chamadas === 2 && t.nomes().includes('session:renewed'))
}

console.log('\nfalha — sem prazo sobrando, avisa que expirou:')
{
  const t = montar({ renovar: async () => { throw new Error('backend fora') } })
  t.s.programar({ vxToken: 'velho', expiresIn: 30 })
  await t.relogio.avancar(60 * 1000)
  const expirou = t.eventos.filter((e) => e.nome === 'session:expired')
  check('avisa session:expired', expirou.length === 1, t.nomes())
  check('com o motivo', /backend fora/.test(expirou[0]?.payload?.reason))
  await t.s.renovarAgora('401')
  check('e não repete o aviso', t.eventos.filter((e) => e.nome === 'session:expired').length === 1)
}

console.log('\nfalha — refreshSession devolveu algo sem vxToken:')
{
  const t = montar({ renovar: async () => ({ expiresIn: 3600 }) })
  t.s.programar({ vxToken: 'velho', expiresIn: 30 })
  const ok = await t.s.renovarAgora('401')
  check('não aplica', ok === false && t.aplicadas.length === 0)
  check('avisa expiração com o motivo',
    /vxToken/.test(t.eventos.find((e) => e.nome === 'session:expired')?.payload?.reason))
}

console.log('\nsem refreshSession — o integrador fica sabendo:')
{
  const t = montar()
  t.s.programar(HORA)
  await t.relogio.avancar(55 * 60 * 1000)
  const aviso = t.eventos.find((e) => e.nome === 'session:expiring')
  check('avisa session:expiring no prazo', !!aviso, t.nomes())
  check('com o instante do vencimento', aviso?.payload?.expiresAt === 3600 * 1000)
  await t.s.renovarAgora('401')
  check('o 401 vira session:expired', t.nomes().includes('session:expired'))
}

console.log('\nparar — destruído não renova:')
{
  let chamadas = 0
  const t = montar({ renovar: async () => { chamadas++; return { vxToken: 'novo', expiresIn: 3600 } } })
  t.s.programar(HORA)
  t.s.parar()
  await t.relogio.avancar(2 * 60 * 60 * 1000)
  check('nenhuma chamada depois do destroy', chamadas === 0)
  check('nenhum timer pendurado', t.relogio.pendentes() === 0)
}

console.log('\nsetAuth — recomeça a contagem:')
{
  let chamadas = 0
  const t = montar({ renovar: async () => { chamadas++; return { vxToken: 'r', expiresIn: 3600 } } })
  t.s.programar(HORA)
  await t.relogio.avancar(50 * 60 * 1000)
  t.s.programar({ vxToken: 'trocado', expiresIn: 3600 })
  await t.relogio.avancar(10 * 60 * 1000)
  check('o prazo do token anterior não dispara mais', chamadas === 0)
  check('um timer só', t.relogio.pendentes() === 1)
}

console.log('\nopções — refreshMargin e refreshRetry:')
{
  check('refreshMargin 600 renova 10 min antes', prazoDeRenovacao(3600, 600) === 50 * 60 * 1000,
    prazoDeRenovacao(3600, 600))
  check('folga maior que o token fica em metade do prazo',
    prazoDeRenovacao(3600, 99999) === 30 * 60 * 1000, prazoDeRenovacao(3600, 99999))
  check('refreshMargin inválida volta ao padrão',
    prazoDeRenovacao(3600, -5) === 55 * 60 * 1000 && prazoDeRenovacao(3600, 'x') === 55 * 60 * 1000)
  check('refreshRetry 10 espera 10 s', esperaEntreTentativas(10) === 10 * 1000)
  check('refreshRetry tem piso de 5 s', esperaEntreTentativas(1) === 5 * 1000)
  check('sem refreshRetry, 30 s', esperaEntreTentativas(undefined) === 30 * 1000)

  let chamadas = 0
  const t = montar({
    margem: 600,
    retry: 10,
    renovar: async () => {
      chamadas++
      if (chamadas === 1) throw new Error('rede caiu')
      return { vxToken: 'novo', expiresIn: 3600 }
    },
  })
  t.s.programar(HORA)
  await t.relogio.avancar(50 * 60 * 1000)
  check('o widget aplica a folga pedida', chamadas === 1)
  await t.relogio.avancar(10 * 1000)
  check('e o intervalo de nova tentativa pedido', chamadas === 2 && t.nomes().includes('session:renewed'))
}

console.log('\nfiação — o widget usa tudo isso:')
{
  const widget = await readFile(join(ROOT, 'src/widget.js'), 'utf8')
  const index = await readFile(join(ROOT, 'src/index.js'), 'utf8')
  check('o widget mantém a sessão', /manterSessao\(/.test(widget))
  check('passa o refreshSession do integrador', /renovar:\s*refreshSession/.test(widget))
  check('o 401 do ramal dispara a renovação', /onErroSessao:[^\n]*renovarAgora\('401'\)/.test(widget))
  check('a validade não é herdada na renovação', /expiresIn:\s*nova\.expiresIn/.test(widget))
  check('setAuth passa pelo widget', /requireInstance\(\)\.setAuth\(/.test(index))
  check('destroy para a renovação', /sessaoViva\.parar\(\)/.test(widget))
  check('repassa refreshMargin e refreshRetry',
    /margem:\s*refreshMargin/.test(widget) && /retry:\s*refreshRetry/.test(widget))
}

console.log(`\n${pass} passaram, ${fail} falharam`)
process.exit(fail ? 1 : 0)
