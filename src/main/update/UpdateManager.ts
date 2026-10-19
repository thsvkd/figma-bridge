import type { UpdateState, UpdateStatus } from '@shared/types'

interface UpdateInfo {
  version: string
}

interface DownloadProgress {
  percent: number
}

/** The subset of electron-updater's `AppUpdater` that UpdateManager uses. */
export interface UpdateClient {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  on(event: 'error', listener: (error: Error) => void): unknown
  on(event: 'update-available', listener: (info: UpdateInfo) => void): unknown
  on(event: 'update-not-available', listener: (info: UpdateInfo) => void): unknown
  on(event: 'download-progress', listener: (progress: DownloadProgress) => void): unknown
  on(event: 'update-downloaded', listener: (info: UpdateInfo) => void): unknown
  checkForUpdates(): Promise<unknown>
  downloadUpdate(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

/**
 * No re-check in these states: checking and downloading are already in flight, and a re-check
 * during ready would turn an already downloaded update back into `available`, so the user
 * would download the same file again.
 */
const CHECK_BLOCKING_STATUSES: readonly UpdateStatus[] = ['checking', 'downloading', 'ready']

interface UpdateSupportOptions {
  isPackaged: boolean
  platform: string
  isSmokeTest: boolean
}

export function isAutomaticUpdateSupported(options: UpdateSupportOptions): boolean {
  return options.isPackaged && options.platform === 'win32' && !options.isSmokeTest
}

export class UpdateManager {
  private state: UpdateState

  constructor(
    private readonly currentVersion: string,
    private readonly updater: UpdateClient | null,
    private readonly emit: (state: UpdateState) => void
  ) {
    this.state = { status: updater ? 'idle' : 'unsupported', currentVersion }
    if (!updater) return

    // Download and install only on the user's click.
    updater.autoDownload = false
    updater.autoInstallOnAppQuit = false

    updater.on('update-available', (info) => {
      this.setState({ status: 'available', currentVersion, version: info.version })
    })
    updater.on('update-not-available', () => {
      this.setState({ status: 'up-to-date', currentVersion })
    })
    updater.on('download-progress', (progress) => {
      this.setState({ ...this.state, status: 'downloading', progress: progress.percent })
    })
    updater.on('update-downloaded', (info) => {
      this.setState({ status: 'ready', currentVersion, version: info.version, progress: 100 })
    })
    updater.on('error', (error) => this.setError(error))
  }

  getState(): UpdateState {
    return { ...this.state }
  }

  async check(): Promise<UpdateState> {
    if (!this.updater || CHECK_BLOCKING_STATUSES.includes(this.state.status)) {
      return this.getState()
    }

    this.setState({ status: 'checking', currentVersion: this.currentVersion })
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      // Offline or GitHub unreachable: report it and leave the app usable; check() can be retried.
      this.setError(error)
    }
    return this.getState()
  }

  async download(): Promise<UpdateState> {
    if (!this.updater || this.state.status !== 'available') return this.getState()

    this.setState({ ...this.state, status: 'downloading', progress: 0 })
    try {
      await this.updater.downloadUpdate()
    } catch (error) {
      this.setError(error)
    }
    return this.getState()
  }

  install(): void {
    if (!this.updater || this.state.status !== 'ready') return
    this.updater.quitAndInstall(false, true)
  }

  private setError(error: unknown): void {
    this.setState({
      status: 'error',
      currentVersion: this.currentVersion,
      error: error instanceof Error ? error.message : String(error),
    })
  }

  private setState(state: UpdateState): void {
    this.state = state
    this.emit(this.getState())
  }
}
