export type BridgeStatus = 'off' | 'relay-only' | 'connected'

export type HarnessId = 'claude' | 'claude-desktop' | 'codex'

export interface HarnessState {
  id: HarnessId
  name: string
  installed: boolean
  registered: boolean
}

export interface BridgeState {
  switchOn: boolean
  status: BridgeStatus
  busy: boolean
  figmaInstalled: boolean
  figmaRunning: boolean
  harness: HarnessState[]
  message?: string
}

export type UpdateStatus =
  | 'unsupported'
  | 'idle'
  | 'checking'
  | 'up-to-date'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'error'

export interface UpdateState {
  status: UpdateStatus
  currentVersion: string
  version?: string
  progress?: number
  error?: string
}

export interface AppSettings {
  launchAtLogin: boolean
}

export interface DoctorCheck {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  text: string
  hint?: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  applied: string[]
  ok: boolean
}

export interface HarnessInstallReport {
  ok: boolean
  detail: string
  manualUrl: string
  needsLogin: boolean
}

export interface AiDoctorReport {
  harness: string
  exitCode: number
  output: string
  after: DoctorReport
}

export const IPC = {
  getState: 'bridge:get-state',
  turnOn: 'bridge:turn-on',
  turnOff: 'bridge:turn-off',
  attachPlugin: 'bridge:attach-plugin',
  state: 'bridge:state',
  updateGet: 'update:get',
  updateCheck: 'update:check',
  updateDownload: 'update:download',
  updateInstall: 'update:install',
  updateState: 'update:state',
  doctorRun: 'doctor:run',
  doctorAi: 'doctor:ai',
  harnessInstall: 'harness:install',
  harnessLogin: 'harness:login',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
} as const

/** What the preload script exposes to the renderer as `window.bridge`. */
export interface BridgeApi {
  getState(): Promise<BridgeState>
  turnOn(): Promise<BridgeState>
  turnOff(): Promise<BridgeState>
  attachPlugin(): Promise<BridgeState>
  onState(cb: (state: BridgeState) => void): () => void
  update: {
    getState(): Promise<UpdateState>
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    install(): Promise<void>
    onState(cb: (state: UpdateState) => void): () => void
  }
  doctor: {
    run(fix: boolean): Promise<DoctorReport>
    ai(): Promise<AiDoctorReport>
  }
  harness: {
    install(id: HarnessId): Promise<HarnessInstallReport>
    login(id: HarnessId): Promise<string>
  }
  settings: {
    get(): Promise<AppSettings>
    set(patch: Partial<AppSettings>): Promise<AppSettings>
  }
}
