export type LauncherIcon = 'phone-waves' | 'waveform' | 'headset' | 'chat-phone'

export interface BravophoneOptions {
  /** Origem do webphone hospedado. Padrão: https://webphone.bravophone.com/embed/ */
  hostUrl?: string
  /** Token de sessão do usuário, emitido pelo backend do integrador. */
  token?: string
  /** Canto inicial da janela. Padrão: 'bottom-right'. */
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'
  /** Abrir já visível. Padrão: false (mostra só o botão flutuante). */
  open?: boolean
  /** Exibir a aba lateral de abertura. Padrão: true. */
  launcher?: boolean
  /** Lado da viewport em que a aba fica colada. Padrão: 'right'. */
  launcherSide?: 'right' | 'left'
  /** Desenho da aba. Padrão: 'phone-waves'. */
  launcherIcon?: LauncherIcon
  /** Texto da barra de título. Só usado quando `frame: 'bar'`. */
  title?: string
  /**
   * Moldura da janela. Padrão: `'none'`.
   * - `'none'`: sem barra de título — a UI do webphone ocupa 100% da janela e o
   *   arraste acontece pelo próprio app. Só um botão de fechar no hover.
   * - `'bar'`: adiciona barra com título, indicador de estado, minimizar e fechar.
   */
  frame?: 'none' | 'bar'
  /**
   * O que arrastar até a borda superior faz. Padrão: `'max'` (gesto universal).
   * Use `'top-half'` para que o topo encaixe na metade superior — o máximo
   * continua disponível por `dock('max')`.
   */
  dockTop?: 'max' | 'top-half'
}

export interface CallInfo {
  id: string | null
  number: string | null
  direction: 'inbound' | 'outbound' | null
}

export interface PhoneStatus {
  /** O app terminou de montar e aceita comandos. */
  ready: boolean
  inCall: boolean
  /** Fase bruta do bundle (dialing, ringing, answered…), quando disponível. */
  phase: string | null
  number: string | null
  incoming: boolean
  muted: boolean
  held: boolean
}

export type DockZone =
  /** Altura cheia, colada numa lateral; a largura atual é mantida. */
  | 'left' | 'right'
  /** Metade da tela na horizontal: largura W/2, altura cheia. */
  | 'left-half' | 'right-half'
  /** Largura cheia, metade da tela na vertical: altura H/2. */
  | 'top-half' | 'bottom-half'
  /** Metade da altura, mantendo a largura atual. */
  | 'top' | 'bottom'
  | 'max'
  /** Solta o encaixe e devolve o tamanho flutuante anterior. */
  | 'float'

export interface Geometry {
  x: number
  y: number
  width: number
  height: number
  /** Zona encaixada, ou null quando a janela está flutuando. */
  dock: Exclude<DockZone, 'float'> | null
}

export interface BravophoneEvents {
  ready: { version: string }
  state: { state: 'connecting' | 'ready' | 'ringing' | 'incall' | 'error' }
  'call:incoming': CallInfo
  'call:dialing': CallInfo
  'call:answered': CallInfo
  'call:ended': CallInfo
  'call:failed': CallInfo & { reason?: string }
  resize: { width: number; height: number; dock: Exclude<DockZone, 'float'> | null }
  open: undefined
  close: undefined
  error: { message: string }
}

export interface BravophoneInstance {
  el: HTMLElement
  show(): void
  hide(): void
  toggle(): void
  readonly isOpen: boolean
  minimize(force?: boolean): void
  move(x: number, y: number): void
  resize(width: number, height: number): void
  dock(zone: DockZone): void
  setLauncherSide(side: 'right' | 'left'): void
  setLauncherIcon(name: LauncherIcon): void
  readonly geometry: Geometry
  destroy(): void
}

export interface BravophoneAPI {
  init(options?: BravophoneOptions): BravophoneInstance

  show(): void
  hide(): void
  toggle(): void
  minimize(force?: boolean): void
  move(x: number, y: number): void
  resize(width: number, height: number): void
  /** Encaixa a janela numa zona da viewport, ou 'float' para soltar. */
  dock(zone: DockZone): void
  readonly isOpen: boolean
  readonly geometry: Geometry | null

  /** Disca um número. Formato livre; a normalização é a mesma da extensão. */
  call(number: string, meta?: Record<string, unknown>): Promise<{ ok: true }>
  hangup(): Promise<{ ok: true }>
  answer(): Promise<{ ok: true }>
  /** Alterna o mudo. O bundle só expõe toggle — não aceita estado alvo. */
  mute(): Promise<{ ok: true }>
  /** Alterna a espera. Também é toggle, não set. */
  hold(): Promise<{ ok: true }>
  sendDTMF(tone: string): Promise<{ ok: true }>
  transfer(to: string): Promise<{ ok: true }>
  getStatus(): Promise<PhoneStatus>
  setAuth(token: string): Promise<{ ok: true }>
  logout(): Promise<{ ok: true }>

  on<K extends keyof BravophoneEvents>(
    event: K,
    handler: (payload: BravophoneEvents[K]) => void,
  ): () => void
  off<K extends keyof BravophoneEvents>(
    event: K,
    handler: (payload: BravophoneEvents[K]) => void,
  ): void

  destroy(): void
  readonly version: string
}

declare const Bravophone: BravophoneAPI
export default Bravophone

declare global {
  interface Window {
    Bravophone: BravophoneAPI
  }
}
