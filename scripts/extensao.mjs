// Onde está a extensão, em um só lugar.
//
// A extensão é a fonte da verdade do webphone, e meio repositório depende de
// achá-la: o sync copia os assets de lá, e sete smoke tests leem os arquivos
// dela direto para prender o contrato.
//
// Cada um escrevia o caminho à mão, sempre '../Bravophone'. A pasta do
// repositório se chama 'bravophone-extension', e o `npm publish` chama o
// prepare:host e o npm test SEM argumento — então um nome diferente derrubava o
// release com a extensão ali do lado, e em dois passos distintos.

import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Nomes aceitos ao lado do SDK, em ordem de preferência. */
export const NOMES = ['Bravophone', 'bravophone-extension']

/**
 * O caminho da extensão. Com `pedido`, é ele e ponto — quem passa caminho
 * manda. Sem, procura os nomes conhecidos ao lado do SDK; não achando nenhum,
 * devolve o primeiro, para a mensagem de erro de quem chamou falar de um lugar
 * concreto.
 */
export function caminhoDaExtensao(pedido) {
  if (pedido) return resolve(pedido)
  const achado = NOMES.map((n) => join(ROOT, '..', n)).find(existsSync)
  return resolve(achado || join(ROOT, '..', NOMES[0]))
}

/** Um arquivo dentro da extensão. */
export function naExtensao(...partes) {
  return join(caminhoDaExtensao(), ...partes)
}
