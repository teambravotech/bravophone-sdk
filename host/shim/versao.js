/**
 * versao.js — mostra a versão no fim da aba Ajustes.
 *
 * O bundle só mostra a versão no rodapé do login; depois de logado ela some.
 * Arquivo próprio, e não parte do guest-bridge, porque o guest-bridge sai cedo
 * fora de iframe — e o app nativo carrega o host/ direto, sem iframe.
 *
 * Mesma fonte do rodapé do login: a presença primeiro (que dá prioridade à
 * versão do app nativo, em bravophoneNative.versao); senão o getManifest() do
 * chrome-shim, que devolve a versão do package.json. Mesmas classes do rodapé,
 * para acompanhar os dois temas.
 *
 * Texto em ASCII com escape: no modo srcdoc este arquivo vem do CDN, e um
 * acento cru dependeria do charset chegar certo.
 */
;(function () {
  'use strict'

  function versao() {
    try {
      var p = window.__bpPresenca
      var v = p && p.versao && p.versao()
      if (v) return v
    } catch (_) {}
    try { return chrome.runtime.getManifest().version } catch (_) { return null }
  }

  function aplicar() {
    var aba = document.querySelector('.settings-tab')
    if (!aba || aba.querySelector('.bcvoz-versao')) return
    var v = versao()
    if (!v) return
    var el = document.createElement('div')
    el.className = 'bcvoz-versao text-tiny text-gray-300 tracking-wider text-center'
    el.style.padding = '4px 0 2px'
    el.textContent = 'Versão ' + v
    aba.appendChild(el)
  }

  // A aba é recriada a cada troca de aba: o observador recoloca a linha
  // sempre que ela volta. O custo por mutação é um querySelector.
  function ligar() {
    aplicar()
    new MutationObserver(aplicar).observe(document.body, { childList: true, subtree: true })
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar)
  else ligar()
})()
