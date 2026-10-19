import { ipcMain } from 'electron'
import {
  IPC,
  type AiDoctorReport,
  type AppSettings,
  type BridgeState,
  type DoctorReport,
  type HarnessId,
  type HarnessInstallReport,
  type UpdateState,
} from '@shared/types'

export interface IpcDeps {
  bridge: {
    getState(): BridgeState
    turnOn(): Promise<BridgeState>
    turnOff(): Promise<BridgeState>
    attachPlugin(): Promise<BridgeState>
    /** Re-applies the saved switch value after a tool was installed, so a new tool gets its MCP entry. */
    restore(): Promise<BridgeState>
  }
  updates: {
    getState(): UpdateState
    check(): Promise<UpdateState>
    download(): Promise<UpdateState>
    install(): void
  }
  getSettings(): AppSettings
  setSettings(patch: Partial<AppSettings>): AppSettings
  runDoctor(fix: boolean): Promise<DoctorReport>
  runAiDoctor(): Promise<AiDoctorReport>
  installHarness(id: HarnessId): Promise<HarnessInstallReport>
  loginHarness(id: HarnessId): Promise<string>
}

const HARNESS_IDS: readonly HarnessId[] = ['claude', 'claude-desktop', 'codex']

function harnessId(value: unknown): HarnessId {
  if (!HARNESS_IDS.includes(value as HarnessId)) throw new Error(`Unknown harness: ${String(value)}`)
  return value as HarnessId
}

export function registerIpc(deps: IpcDeps): void {
  const handle = (channel: string, fn: (...args: unknown[]) => unknown) =>
    ipcMain.handle(channel, (_event, ...args) => fn(...args))

  handle(IPC.getState, () => deps.bridge.getState())
  handle(IPC.turnOn, () => deps.bridge.turnOn())
  handle(IPC.turnOff, () => deps.bridge.turnOff())
  handle(IPC.attachPlugin, () => deps.bridge.attachPlugin())

  handle(IPC.updateGet, () => deps.updates.getState())
  handle(IPC.updateCheck, () => deps.updates.check())
  handle(IPC.updateDownload, () => deps.updates.download())
  handle(IPC.updateInstall, () => deps.updates.install())

  handle(IPC.doctorRun, (fix) => deps.runDoctor(fix === true))
  handle(IPC.doctorAi, () => deps.runAiDoctor())
  handle(IPC.harnessInstall, async (id) => {
    const result = await deps.installHarness(harnessId(id))
    await deps.bridge.restore()
    return result
  })
  handle(IPC.harnessLogin, (id) => deps.loginHarness(harnessId(id)))

  handle(IPC.settingsGet, () => deps.getSettings())
  handle(IPC.settingsSet, (patch) => {
    const launchAtLogin = (patch as Partial<AppSettings> | null)?.launchAtLogin
    return deps.setSettings(typeof launchAtLogin === 'boolean' ? { launchAtLogin } : {})
  })
}
