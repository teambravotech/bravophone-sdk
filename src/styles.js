// CSS injetado dentro do Shadow DOM do widget.
// Fica isolado: nada aqui vaza para a página do cliente e nada da página
// do cliente entra aqui (nem Tailwind, nem reset agressivo, nem !important).
import { ICON_STATE_CSS } from './icons.js'

export const WIDGET_CSS = `
:host {
  /* A moldura do widget vive no Shadow DOM, fora do iframe — o
     tema-claro.css do webphone não a alcança. Então ela tem os próprios
     tokens, e o widget.js os alterna ouvindo o evento theme:changed que o
     webphone emite ao trocar de tema.

     Só o que é MOLDURA entra aqui. A cor da marca no lançador, o vermelho do
     badge e o verde/âmbar do status não mudam com o tema: são identidade e
     semântica, e valem igual nos dois. */
  all: initial;

  /* ---- marca ----
     Os valores abaixo são a marca BCVOZ, e continuam valendo quando o
     integrador não pede outra. Com brand.color no init, o widget.js
     sobrescreve estes tokens no style inline do host (ver src/marca.js) —
     inline vence o "all: initial", e "all" não alcança custom property.
     Ficam fora do bloco do tema claro de propósito: marca é identidade, e
     identidade não troca de cor quando o usuário troca de tema. */
  --bpw-marca: #6c5ce7;
  --bpw-marca-hover: #5b4bd6;
  /* Realce sobre fundo escuro: botão de Recentes aberto, halo de atenção. */
  --bpw-marca-clara: #8b7cf8;
  /* Anel de foco por teclado: precisa contrastar com a própria marca. */
  --bpw-marca-foco: #c7d2fe;
  /* Estes dois são TRIPLOS "r,g,b", não cores: entram em rgba(...) com
     opacidades diferentes, e rgba() não aceita hex dentro. */
  --bpw-marca-sombra: 76,58,190;
  --bpw-marca-halo: 124,108,245;
  /* Altura do logo do integrador na barra de título. */
  --bpw-logo-altura: 16px;

  --bpw-bg: #1e1e2d;
  --bpw-header-bg: #15151f;
  --bpw-texto: #e6e6f0;
  --bpw-texto-dim: #9ca3af;
  --bpw-texto-fraco: #cbd5e1;
  --bpw-borda: rgba(255,255,255,.06);
  --bpw-sombra: rgba(0,0,0,.45);
  --bpw-overlay-bg: rgba(10,10,16,.72);
  --bpw-realce: rgba(255,255,255,.08);
  --bpw-alca: rgba(255,255,255,.3);
  --bpw-texto-forte: #fff;
}

:host([data-bp-tema="claro"]) {
  --bpw-bg: #ffffff;
  --bpw-header-bg: #f4f6fa;
  --bpw-texto: #161a24;
  --bpw-texto-dim: #5a6379;
  --bpw-texto-fraco: #5a6379;
  --bpw-borda: rgba(16,24,40,.12);
  --bpw-sombra: rgba(16,24,40,.18);
  --bpw-overlay-bg: rgba(255,255,255,.88);
  --bpw-realce: rgba(15,23,42,.07);
  --bpw-alca: rgba(15,23,42,.28);
  --bpw-texto-forte: #161a24;
}

* { box-sizing: border-box; }

.bp-root {
  position: fixed;
  z-index: 2147483000;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  background: var(--bpw-bg);
  border-radius: 12px;
  box-shadow: 0 12px 40px var(--bpw-sombra), 0 0 0 1px var(--bpw-borda);
  overflow: hidden;
  will-change: transform;
}
.bp-root[hidden] { display: none !important; }
.bp-root { transition: left .16s ease, top .16s ease, width .16s ease, height .16s ease; }
.bp-root.bp-dragging,
.bp-root.bp-resizing { transition: none; user-select: none; }
.bp-root.bp-minimized .bp-body,
.bp-root.bp-minimized /* ---- modo sem moldura (frame:'none', padrao) ----
   A UI do webphone ocupa 100% da janela. Os controles ficam sobrepostos,
   invisiveis ate o hover, e nunca empurram nem redimensionam o conteudo. */
.bp-root.bp-chromeless .bp-header { display: none; }
.bp-root.bp-chromeless .bp-overlay { display: flex; }

.bp-overlay {
  position: absolute;
  top: 6px; right: 6px;
  display: none;
  gap: 2px;
  padding: 3px;
  border-radius: 8px;
  background: var(--bpw-overlay-bg);
  backdrop-filter: blur(6px);
  opacity: 0;
  transition: opacity .14s ease;
  z-index: 3;
  pointer-events: none;
}
.bp-root.bp-chromeless:hover .bp-overlay,
.bp-root.bp-chromeless:focus-within .bp-overlay { opacity: 1; pointer-events: auto; }
.bp-root.bp-dragging .bp-overlay { opacity: 0; pointer-events: none; }
.bp-overlay .bp-btn { width: 22px; height: 22px; font-size: 13px; color: var(--bpw-texto-fraco); }

/* Sem barra de titulo o arraste vem de dentro do iframe: o cursor tambem. */
.bp-root.bp-chromeless.bp-dragging { cursor: grabbing; }

.bp-resize { display: none; }
.bp-root.bp-minimized { height: auto !important; }

.bp-header {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 36px;
  padding: 0 6px 0 12px;
  background: var(--bpw-header-bg);
  color: var(--bpw-texto);
  cursor: grab;
  flex: 0 0 auto;
  touch-action: none;
}
.bp-header:active { cursor: grabbing; }
.bp-title {
  flex: 1 1 auto;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: .3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* Logo do integrador, no lugar do título. O object-position à esquerda mantém
   o desenho encostado na borda.
   O margin-right: auto é que empurra os botões para a borda direita. Com
   flex-grow o logo esticaria, mas o max-width o trava em 62% e a sobra de
   espaço cairia DEPOIS do último filho - o buraco à direita do X. Margem
   automática come essa sobra antes de ela virar buraco.
   O pointer-events: none é o que importa: a barra inteira é a alça de arraste,
   e um <img> no caminho roubaria o gesto para o drag nativo do navegador. */
.bp-logo {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 62%;
  margin-right: auto;
  height: var(--bpw-logo-altura);
  width: auto;
  object-fit: contain;
  object-position: left center;
  display: block;
  pointer-events: none;
  -webkit-user-drag: none;
  user-select: none;
}
.bp-status {
  width: 8px; height: 8px; border-radius: 50%;
  background: #6b7280; flex: 0 0 auto;
}
.bp-status[data-state="ready"]    { background: #22c55e; }
.bp-status[data-state="ringing"]  { background: #f59e0b; animation: bp-pulse 1s infinite; }
.bp-status[data-state="incall"]   { background: #22c55e; animation: bp-pulse 2s infinite; }
.bp-status[data-state="error"]    { background: #ef4444; }
@keyframes bp-pulse { 0%,100% { opacity: 1 } 50% { opacity: .35 } }

.bp-btn {
  width: 24px; height: 24px;
  display: grid; place-items: center;
  border: 0; border-radius: 6px;
  background: transparent; color: var(--bpw-texto-dim);
  cursor: pointer; font-size: 15px; line-height: 1;
  flex: 0 0 auto; padding: 0;
}
.bp-btn:hover { background: var(--bpw-realce); color: var(--bpw-texto-forte); }
.bp-btn-close:hover { background: #dc2626; color: #fff; }
.bp-btn-recentes svg { display: block; }
/* Aberto: a cor da marca diz "este painel está à mostra". */
.bp-btn-recentes[aria-pressed="true"] { color: var(--bpw-marca-clara); background: var(--bpw-realce); }

.bp-body { flex: 1 1 auto; position: relative; min-height: 0; }
.bp-frame {
  width: 100%; height: 100%;
  border: 0; display: block; background: var(--bpw-bg);
}
/* Durante o arraste o iframe precisa parar de capturar o ponteiro,
   senão o mousemove é engolido pelo documento interno e o drag "trava". */
.bp-root.bp-dragging .bp-frame,
.bp-root.bp-resizing .bp-frame { pointer-events: none; }

/* ---- alcas de redimensionamento (8 bordas/cantos) ----
   Faixas invisiveis por fora da borda: nao cobrem a UI do webphone e ainda
   assim dao uma area de clique confortavel. */
.bp-h {
  position: absolute;
  z-index: 4;
  touch-action: none;
}
.bp-h-n { top: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
.bp-h-s { bottom: -4px; left: 10px; right: 10px; height: 8px; cursor: ns-resize; }
.bp-h-w { left: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
.bp-h-e { right: -4px; top: 10px; bottom: 10px; width: 8px; cursor: ew-resize; }
.bp-h-nw { top: -4px; left: -4px; width: 14px; height: 14px; cursor: nwse-resize; }
.bp-h-ne { top: -4px; right: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
.bp-h-sw { bottom: -4px; left: -4px; width: 14px; height: 14px; cursor: nesw-resize; }
.bp-h-se { bottom: -4px; right: -4px; width: 14px; height: 14px; cursor: nwse-resize; }

/* Marcador visivel so no canto inferior direito, como affordance. */
.bp-h-se::after {
  content: ''; position: absolute; right: 3px; bottom: 3px;
  width: 9px; height: 9px;
  background: linear-gradient(135deg, transparent 50%, var(--bpw-alca) 50%);
}

/* Uma janela docada nao se redimensiona pelas bordas coladas na viewport. */
.bp-root.bp-docked { border-radius: 0; }

/* ---- destaque: "a janela esta aqui" ----
   Disparado ao clicar na aba com o webphone ja aberto. Um halo que cresce e
   some, no lugar de um shake: em interface, tremer significa erro ou acao
   negada (senha errada), e aqui nada deu errado. */
@keyframes bp-attention {
  0%   { box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 0 rgba(var(--bpw-marca-halo),.55); }
  55%  { box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 12px rgba(var(--bpw-marca-halo),0); }
  100% { box-shadow: 0 12px 40px rgba(0,0,0,.45), 0 0 0 0 rgba(var(--bpw-marca-halo),0); }
}
.bp-root.bp-attention { animation: bp-attention .85s ease-out 2; }

@media (prefers-reduced-motion: reduce) {
  .bp-root.bp-attention { animation: none; outline: 2px solid var(--bpw-marca-clara); outline-offset: 2px; }
}

/* ---- previa de encaixe (docking) ----
   Fantasma que mostra onde a janela vai parar antes de soltar. */
.bp-preview {
  position: fixed;
  z-index: 2147482998;
  border-radius: 10px;
  background: rgba(37,99,235,.18);
  border: 2px solid rgba(96,165,250,.85);
  box-shadow: 0 0 0 1px rgba(0,0,0,.25), inset 0 0 40px rgba(96,165,250,.15);
  pointer-events: none;
  transition: left .12s ease, top .12s ease, width .12s ease, height .12s ease;
}
.bp-preview[hidden] { display: none !important; }

.bp-launcher {
  position: fixed;
  top: 50%;
  /* Acima da janela (2147483000): a aba nunca some, e uma janela docada na
     mesma borda a esconderia. */
  z-index: 2147483001;
  display: flex;
  align-items: center;
  gap: 0;
  height: 48px;
  padding: 0 11px;
  background: var(--bpw-marca);
  color: #fff;
  border: 0;
  cursor: pointer;
  box-shadow: 0 4px 16px rgba(var(--bpw-marca-sombra),.42), 0 0 0 1px rgba(255,255,255,.08) inset;
  transition: padding .16s ease, background .16s ease, box-shadow .16s ease;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
}
.bp-launcher[hidden] { display: none !important; }

/* Colada na borda: os cantos arredondados sao so os que ficam para dentro. */
.bp-launcher[data-side="right"] { border-radius: 14px 0 0 14px; }
.bp-launcher[data-side="left"]  { border-radius: 0 14px 14px 0; }

.bp-launcher:hover,
.bp-launcher:focus-visible {
  background: var(--bpw-marca-hover);
  box-shadow: 0 6px 22px rgba(var(--bpw-marca-sombra),.55), 0 0 0 1px rgba(255,255,255,.12) inset;
}
.bp-launcher:focus-visible { outline: 2px solid var(--bpw-marca-foco); outline-offset: 2px; }
.bp-launcher.bp-launcher-dragging { cursor: grabbing; transition: none; }

/* Alca de arraste: os pontos ficam sempre com largura fixa e somem por
   opacidade + margem negativa. Animar a largura cortaria o SVG no meio. */
.bp-launcher-grip {
  width: 10px;
  height: 16px;
  flex: 0 0 auto;
  opacity: 0;
  color: rgba(255,255,255,.9);
  cursor: grab;
  transition: opacity .16s ease, margin .16s ease;
}
.bp-launcher-grip svg { display: block; }
.bp-launcher[data-side="right"] .bp-launcher-grip { order: 0; margin-right: -10px; }
.bp-launcher[data-side="left"] .bp-launcher-grip { order: 2; margin-left: -10px; }

.bp-launcher:hover .bp-launcher-grip,
.bp-launcher:focus-visible .bp-launcher-grip,
.bp-launcher.bp-launcher-dragging .bp-launcher-grip { opacity: 1; }
.bp-launcher[data-side="right"]:hover .bp-launcher-grip,
.bp-launcher[data-side="right"]:focus-visible .bp-launcher-grip,
.bp-launcher[data-side="right"].bp-launcher-dragging .bp-launcher-grip { margin-right: 7px; }
.bp-launcher[data-side="left"]:hover .bp-launcher-grip,
.bp-launcher[data-side="left"]:focus-visible .bp-launcher-grip,
.bp-launcher[data-side="left"].bp-launcher-dragging .bp-launcher-grip { margin-left: 7px; }

.bp-launcher-icon {
  position: relative;
  order: 1;
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  pointer-events: none;
}
.bp-launcher-icon svg { width: 100%; height: 100%; display: block; }

.bp-launcher .bp-badge {
  position: absolute;
  top: -5px;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: #ef4444;
  color: #fff;
  font: 700 11px/18px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  text-align: center;
  display: none;
  box-shadow: 0 0 0 2px var(--bpw-marca);
}
.bp-launcher[data-side="right"] .bp-badge { left: -6px; }
.bp-launcher[data-side="left"] .bp-badge { right: -6px; }
.bp-launcher[data-badge]:not([data-badge=""]) .bp-badge { display: block; }

/* Chamada entrante: a aba pulsa para chamar atencao mesmo fechada. */
@keyframes bp-launcher-ring {
  0%, 100% { box-shadow: 0 4px 16px rgba(var(--bpw-marca-sombra),.42); }
  50% { box-shadow: 0 4px 16px rgba(239,68,68,.75), 0 0 0 4px rgba(239,68,68,.25); }
}
.bp-launcher[data-badge]:not([data-badge=""]) { animation: bp-launcher-ring 1.1s infinite; }

@media (prefers-reduced-motion: reduce) {
  .bp-launcher, .bp-launcher-grip { transition: none; }
  .bp-launcher[data-badge]:not([data-badge=""]) { animation: none; }
}

${ICON_STATE_CSS}
`
