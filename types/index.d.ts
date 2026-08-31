export type LauncherIcon = 'phone-waves' | 'waveform' | 'headset' | 'chat-phone'

/** Resposta do `/api/voxfree/login`, repassada como está. */
export interface BravophoneSession {
  vxToken: string
  /** Segundos até expirar; vira `bravophoneVxTokenExpiresAt`. */
  expiresIn?: number
  sip?: string
  tenant?: string
  ramal?: string
  clienteId?: string
  ramaisUrl?: string
  /**
   * O ramal SIP, como vem do `/api/voxfree/login`. **Obrigatório para
   * registrar**: o `checkToken` do webphone exige as duas metades — o
   * `vxToken` da sessão E um `extension` com `username` e `password`. Só a
   * sessão deixa o app parado na tela de login.
   *
   * Onde ele fica: o SDK o envia apenas pela ponte (postMessage) e o aplica
   * no store em memória do webphone. Nunca entra no HTML do iframe nem no
   * localStorage — a credencial SIP não fica legível no DOM da sua página.
   */
  extension?: {
    username: string
    password: string
    server?: string
    authID?: string
    displayName?: string
    label?: string
    [k: string]: unknown
  }
}

export interface BravophoneOptions {
  /** Origem do webphone hospedado. Só usado com `mode: 'hosted'`. */
  hostUrl?: string
  /**
   * Como o webphone é carregado. Padrão: `'hosted'`.
   *
   * - `'hosted'`: o iframe navega para `hostUrl`. Todos os requests saem de uma
   *   origem fixa, então o CORS dos backends não cresce com o número de
   *   clientes. É um iframe de terceiro, sujeito a bloqueadores e a storage
   *   particionado.
   * - `'srcdoc'`: o iframe roda na origem do próprio site e busca o webphone no
   *   CDN. Não é iframe de terceiro e não há partição de storage — mas a origem
   *   do integrador precisa estar na allowlist de CORS dos backends, senão o
   *   webphone carrega e não registra.
   */
  mode?: 'hosted' | 'srcdoc'
  /**
   * Só com `mode: 'srcdoc'`. De onde vêm os arquivos do webphone.
   * Padrão: o CDN travado na versão deste pacote. Precisa terminar com `/`.
   * Use para desenvolvimento (`http://localhost:5174/`) ou para servir os
   * assets de um espelho próprio.
   */
  hostBase?: string
  /**
   * Base da API (ex.: `https://pabx.teambravotech.com`). Com ela, o SDK
   * acompanha o ramal do usuário: se um for atribuído ou trocado no painel,
   * o webphone reage sem novo login. Sem ela, o estado é o do momento do
   * login e só muda com outro login.
   */
  apiBase?: string
  /**
   * Sessão do `/api/voxfree/login`, repassada inteira. É o caminho correto:
   * o webphone precisa de `sip` e `ramal` para registrar.
   */
  session?: BravophoneSession
  /**
   * Atalho para `{ vxToken: token }`. **Sozinho não basta** — sem `sip` e
   * `ramal` o webphone carrega, não registra, e o RouteSelector avisa
   * "faça login pelo webphone".
   */
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
  /**
   * Moldura da janela. Padrão: `'bar'` — título, estado e controles visíveis.
   * `'none'` preserva 100% da UI do webphone: sem barra, o arraste acontece
   * pelo próprio app e só um botão de fechar aparece no hover.
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

export interface BravophoneRoute {
  id: string
  name: string
  /** Prefixo do tronco, somado ao destino do INVITE. '' quando não há. */
  prefix?: string | null
  kind?: string
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
  resize: { width: number; height: number; dock: Exclude<DockZone, 'float'> | null }
  /** O ramal do usuário mudou de estado — ver `reason`. */
  extension: {
    hasExtension: boolean
    reason: 'ok' | 'no_extension_assigned' | 'extension_invalid'
      | 'relogin_required' | 'credentials_not_available'
    message: string | null
  }
  open: undefined
  close: undefined
  reveal: undefined
  error: { message: string }
}

export interface BravophoneInstance {
  el: HTMLElement
  show(): void
  hide(): void
  toggle(): void
  /** Abre a janela; se já estiver aberta, traz para a vista e destaca. */
  reveal(): void
  readonly isOpen: boolean
  minimize(force?: boolean): void
  reveal(): void
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

  /** Escreve no campo sem discar — para a pessoa conferir antes de ligar. */
  setDial(number: string): Promise<{ ok: true; number: string }>
  clearDial(): Promise<{ ok: true }>

  /**
   * Troncos disponíveis e qual está em uso.
   *
   * A rota decide por qual provedora a ligação sai, e o prefixo dela entra
   * no destino do INVITE.
   */
  getRoutes(): Promise<{ routes: BravophoneRoute[]; selected: BravophoneRoute | null; prefix: string }>
  /** Troca a provedora pela qual as próximas ligações saem. */
  setRoute(id: string): Promise<{ ok: true; selected: BravophoneRoute | null; prefix: string }>
  setAuth(session: BravophoneSession | string): Promise<{ ok: true }>
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
