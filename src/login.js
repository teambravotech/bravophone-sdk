// O login feito pela pessoa, com o e-mail já no lugar.
//
// Nem todo integrador tem a sessão da pessoa para injetar. Quem só sabe o
// e-mail dela — o do próprio cadastro dele — deixa o webphone subir na tela de
// login do bundle e adianta essa metade: `init({ email })`. A pessoa digita só
// a senha, e nada da identidade dela passa pelo backend do integrador.
//
// POR QUE O FORMATO É VALIDADO AQUI, e não deixado para o backend recusar: o
// e-mail não para na tela. Depois de um login bem-sucedido, o gerenciador de
// contas do webphone (`bravophone-contas.js`) registra a conta sob esse
// endereço — é ele que a lista mostra e que o próximo acesso procura. Lá, um
// endereço torto é recusado em silêncio (`registrarAtiva` exige o `@`), e a
// conta simplesmente não aparece. Barrar cedo, com aviso no console, deixa o
// problema onde ele nasceu: na chamada do `init`.
//
// A regra é a mais frouxa que serve — algo, `@`, algo, ponto, algo. Decidir
// por regex se um e-mail existe é lenda; quem diz isso é o login.

const FORMA = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * O e-mail pronto para a tela de login, ou null quando não serve.
 *
 * Minúsculas e sem espaços nas pontas, como o gerenciador de contas também
 * normaliza — senão o mesmo endereço viraria duas contas na lista.
 *
 * @param {unknown} valor  o que veio em `init({ email })`
 * @returns {string|null}
 */
export function normalizarEmail(valor) {
  if (valor === undefined || valor === null || valor === '') return null
  const email = String(valor).trim().toLowerCase()
  if (!FORMA.test(email)) {
    console.warn(
      '[BCVoz] email ignorado, formato invalido: ' + JSON.stringify(valor) +
      ' — a tela de login sobe vazia.')
    return null
  }
  return email
}
