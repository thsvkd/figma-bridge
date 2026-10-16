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
