// Ícones da aba de abertura.
//
// Todos são SVG de traço em `currentColor`, viewBox 24×24, desenhados para
// ler bem a 22px — sem detalhe fino que vire borrão nesse tamanho.
//
// O ícone não é decoração: ele reage ao estado da linha (ver ICON_STATE_CSS),
// então a aba fechada já diz se o webphone está registrado, tocando ou em
// chamada, sem o usuário precisar abri-la.

const A = 'stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'

/** Handset clássico com ondas de sinal — o mais reconhecível. */
const phoneWaves = `<svg viewBox="0 0 24 24" fill="none" ${A} aria-hidden="true">
  <path class="bp-i-body" d="M15.6 12.8a11 11 0 0 1-4.4-4.4l1-1a1.6 1.6 0 0 0 .3-1.7c-.2-.7-.4-1.4-.5-2.2A1.6 1.6 0 0 0 10.4 2H7.9a1.6 1.6 0 0 0-1.6 1.8 15.8 15.8 0 0 0 2.4 6.9 15.6 15.6 0 0 0 4.8 4.8 15.8 15.8 0 0 0 6.9 2.4 1.6 1.6 0 0 0 1.7-1.6v-2.5a1.6 1.6 0 0 0-1.4-1.6c-.8-.1-1.5-.3-2.2-.5a1.6 1.6 0 0 0-1.7.4z"/>
  <path class="bp-i-wave bp-i-wave-1" d="M14.5 6.2a4 4 0 0 1 3.3 3.3"/>
  <path class="bp-i-wave bp-i-wave-2" d="M14.1 2.6a7.6 7.6 0 0 1 7.3 7.3"/>
</svg>`

/** Equalizador: barras que dançam durante a chamada. */
const waveform = `<svg viewBox="0 0 24 24" fill="none" ${A} aria-hidden="true">
  <path class="bp-i-bar bp-i-bar-1" d="M4 10v4"/>
  <path class="bp-i-bar bp-i-bar-2" d="M8.7 6.5v11"/>
  <path class="bp-i-bar bp-i-bar-3" d="M12 3.5v17"/>
  <path class="bp-i-bar bp-i-bar-4" d="M15.3 6.5v11"/>
  <path class="bp-i-bar bp-i-bar-5" d="M20 10v4"/>
</svg>`

/** Headset: fala de atendimento, que é o uso real do Bravophone. */
const headset = `<svg viewBox="0 0 24 24" fill="none" ${A} aria-hidden="true">
  <path class="bp-i-body" d="M4 13v-1a8 8 0 0 1 16 0v1"/>
  <path class="bp-i-body" d="M20 14.5v2a3.5 3.5 0 0 1-3.5 3.5H13"/>
  <rect class="bp-i-cup" x="1.6" y="12.6" width="4.4" height="6.4" rx="1.8"/>
  <rect class="bp-i-cup" x="18" y="12.6" width="4.4" height="6.4" rx="1.8"/>
</svg>`

/** Handset dentro de uma bolha: comunicação, mais "produto" que "telefonia". */
const chatPhone = `<svg viewBox="0 0 24 24" fill="none" ${A} aria-hidden="true">
  <path class="bp-i-body" d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-2.9-.5L3 21.5l1.5-4.6A8.4 8.4 0 0 1 12 3.1a8.4 8.4 0 0 1 9 8.4z"/>
  <path class="bp-i-hand" d="M14.6 14.4a6.5 6.5 0 0 1-3.2-3.2l.7-.7a1 1 0 0 0 .2-1.1 6 6 0 0 1-.3-1.2 1 1 0 0 0-1-.8H9.6a1 1 0 0 0-1 1.1 9.6 9.6 0 0 0 4.8 7.2 1 1 0 0 0 1.4-.9v-1.2a1 1 0 0 0-.8-1z"/>
</svg>`

/**
 * Alça de arraste: 6 pontos em SVG, não `radial-gradient`.
 *
 * O gradiente parecia sujo por dois motivos: a rampa entre a cor e o
 * transparente tinha 0.1px, o que o antialiasing resolve mal, e a repetição do
 * background cortava a última coluna na largura do elemento. Círculos reais
 * ficam nítidos em qualquer densidade de tela e nunca são cortados.
 */
export const GRIP_ICON = `<svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
  <circle cx="2.6" cy="2.6" r="1.35"/><circle cx="7.4" cy="2.6" r="1.35"/>
  <circle cx="2.6" cy="8" r="1.35"/><circle cx="7.4" cy="8" r="1.35"/>
  <circle cx="2.6" cy="13.4" r="1.35"/><circle cx="7.4" cy="13.4" r="1.35"/>
</svg>`

export const ICONS = {
  'phone-waves': phoneWaves,
  waveform,
  headset,
  'chat-phone': chatPhone,
}

export const DEFAULT_ICON = 'phone-waves'

/**
 * CSS que faz o ícone reagir ao estado, aplicado via `data-state` na aba:
 *   connecting · ready · ringing · incall · error
 */
export const ICON_STATE_CSS = `
.bp-launcher-icon svg { width: 100%; height: 100%; display: block; overflow: visible; }

/* Ponto de status no canto do ícone — verde registrado, cinza sem linha. */
.bp-launcher-icon::after {
  content: '';
  position: absolute;
  right: -1px; bottom: -1px;
  width: 7px; height: 7px;
  border-radius: 50%;
  background: #94a3b8;
  box-shadow: 0 0 0 2px #6c5ce7;
  transition: background .2s ease;
}
.bp-launcher[data-state="ready"] .bp-launcher-icon::after   { background: #22c55e; }
.bp-launcher[data-state="error"] .bp-launcher-icon::after   { background: #ef4444; }
/* Tocando ou em chamada, o ponto sai: a animacao ja comunica, e ele sujaria. */
.bp-launcher[data-state="ringing"] .bp-launcher-icon::after,
.bp-launcher[data-state="incall"] .bp-launcher-icon::after  { display: none; }

/* --- ondas do handset: crescem de dentro para fora --- */
.bp-i-wave { opacity: .45; transform-origin: 12px 12px; }
.bp-launcher[data-state="ready"] .bp-i-wave { opacity: .75; }
@keyframes bp-i-emit {
  0%   { opacity: 0; transform: scale(.6); }
  40%  { opacity: 1; }
  100% { opacity: 0; transform: scale(1.15); }
}
.bp-launcher[data-state="ringing"] .bp-i-wave,
.bp-launcher[data-state="incall"] .bp-i-wave {
  animation: bp-i-emit 1.4s ease-out infinite;
}
.bp-launcher[data-state="ringing"] .bp-i-wave-2,
.bp-launcher[data-state="incall"] .bp-i-wave-2 { animation-delay: .35s; }

/* --- handset balanca quando toca, como um telefone de verdade --- */
@keyframes bp-i-shake {
  0%, 100%     { transform: rotate(0deg); }
  15%, 45%     { transform: rotate(-13deg); }
  30%, 60%     { transform: rotate(13deg); }
  75%          { transform: rotate(0deg); }
}
.bp-launcher[data-state="ringing"] .bp-i-body,
.bp-launcher[data-state="ringing"] .bp-i-hand {
  transform-origin: 12px 12px;
  animation: bp-i-shake 1s ease-in-out infinite;
}

/* --- equalizador: barras dancam so em chamada --- */
.bp-i-bar { transform-origin: center; transition: transform .25s ease; }
.bp-launcher[data-state="incall"] .bp-i-bar {
  animation: bp-i-dance .9s ease-in-out infinite;
}
@keyframes bp-i-dance {
  0%, 100% { transform: scaleY(.45); }
  50%      { transform: scaleY(1); }
}
.bp-launcher[data-state="incall"] .bp-i-bar-2 { animation-delay: .12s }
.bp-launcher[data-state="incall"] .bp-i-bar-3 { animation-delay: .24s }
.bp-launcher[data-state="incall"] .bp-i-bar-4 { animation-delay: .36s }
.bp-launcher[data-state="incall"] .bp-i-bar-5 { animation-delay: .48s }

/* Hover: o icone da uma leve subida, so para o botao parecer vivo. */
.bp-launcher:hover .bp-launcher-icon { transform: translateY(-1px); }
.bp-launcher-icon { transition: transform .16s ease; }

@media (prefers-reduced-motion: reduce) {
  .bp-i-wave, .bp-i-body, .bp-i-hand, .bp-i-bar { animation: none !important; }
  .bp-launcher-icon { transition: none; }
}
`
