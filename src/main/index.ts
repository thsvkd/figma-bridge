import { spawn } from 'node:child_process'
import { join } from 'node:path'
import { app, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { IPC, type DoctorReport } from '@shared/types'
import { parseCliArgs, type CliArgs } from './cli'
import { registerIpc } from './ipc'
import { cliMessages } from './messages'
import { createServices, fetchRelayStatus, type Services } from './services'
import { createTray, type TrayController } from './tray'
import { isAutomaticUpdateSupported, UpdateManager, type UpdateClient } from './update/UpdateManager'
import { createWindowController } from './window'

const cli = parseCliArgs(process.argv.slice(1))

const makeServices = () =>
  createServices({
    exePath: process.execPath,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    isPackaged: app.isPackaged,
  })

// The login item always starts the app hidden; it never launches Figma by itself (spec D6).
const applyLoginItem = (openAtLogin: boolean) => {
  if (app.isPackaged) app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })
}

// ---- headless modes: run before the single instance lock so they work while the GUI is open ----

function finish(text: string, code: number, stream: NodeJS.WriteStream = process.stdout): void {
  stream.write(`${text}\n`, () => app.exit(code))
}

async function printStatus(s: Services): Promise<void> {
  const [relay, figmaRunning, harness] = await Promise.all([
    fetchRelayStatus(),
    s.driver.isRunning(),
    s.registry.list(s.launch()),
  ])
  const status = {
    version: app.getVersion(),
    switchOn: s.settings.get().switchOn,
    relay,
    figmaInstalled: s.driver.isInstalled(),
    figmaRunning,
    harness,
  }
  finish(JSON.stringify(status, null, 2), 0)
}

// The relay lives in the GUI process, so the headless doctor asks the app to start it (it restores from the
// saved switch value, which never touches Figma) and waits for /status.
async function startAppRelay(s: Services): Promise<void> {
  if (await fetchRelayStatus()) return
  s.settings.set({ switchOn: true })
  spawn(process.execPath, app.isPackaged ? ['--hidden'] : [app.getAppPath(), '--hidden'], {
    detached: true,
    stdio: 'ignore',
  }).unref()
  for (let i = 0; i < 40; i++) {
    if (await fetchRelayStatus()) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(cliMessages.relayStartTimeout)
}

async function doctorFix(s: Services): Promise<void> {
  let status = await fetchRelayStatus()
  const doctor = s.doctorFor({
    relayStatus: () => status,
    startRelay: async () => {
      await startAppRelay(s)
      status = await fetchRelayStatus()
    },
    // Never used: figmaInput:false below skips every fix that would type into Figma.
    attachPlugin: async () => ({}),
  })
  finish(JSON.stringify(await doctor.run({ fix: true, figmaInput: false }), null, 2), 0)
}

async function cleanup(s: Services): Promise<void> {
  try {
    applyLoginItem(false)
  } catch {
    // The login item is best effort; the MCP entries below are what matters.
  }
  try {
    await s.registry.removeAll()
    finish('{"cleaned":true}', 0)
  } catch (e) {
    finish(cliMessages.cleanupFailed(e instanceof Error ? e.message : String(e)), 1, process.stderr)
  }
}

function runHeadless(mode: Exclude<CliArgs['mode'], 'gui' | 'mcp'>): void {
  const s = makeServices()
  const job = mode === 'status' ? printStatus(s) : mode === 'doctor-fix' ? doctorFix(s) : cleanup(s)
  job.catch((e: unknown) => finish(e instanceof Error ? e.message : String(e), 1, process.stderr))
}

// ---- GUI ----

function runGui(args: CliArgs): void {
  app.setAppUserModelId('com.figma-bridge.app')
  if (!app.requestSingleInstanceLock()) {
    app.exit(0)
    return
  }
  // Closing the window hides it; only the tray's quit ends the app.
  app.on('window-all-closed', () => undefined)

  void app.whenReady().then(async () => {
    const s = makeServices()
    const win = createWindowController({ appPath: app.getAppPath(), showOnCreate: !args.hidden })
    let tray: TrayController | null = null

    const bridge = s.bridge((state) => {
      win.send(IPC.state, state)
      tray?.setBridge(state)
    })

    const client = isAutomaticUpdateSupported({
      isPackaged: app.isPackaged,
      platform: process.platform,
      isSmokeTest: process.env.FIGMA_BRIDGE_SMOKE_TEST === '1',
    })
      ? (autoUpdater as unknown as UpdateClient)
      : null
    const updates = new UpdateManager(app.getVersion(), client, (state) => {
      win.send(IPC.updateState, state)
      tray?.setUpdate(state)
    })

    const quit = () => {
      win.allowClose()
      app.quit()
    }
    tray = createTray(
      {
        open: () => win.show(),
        turnOn: () => void bridge.turnOn(),
        turnOff: () => void bridge.turnOff(),
        attachPlugin: () => void bridge.attachPlugin(),
        quit,
      },
      bridge.getState(),
    )
    tray.setUpdate(updates.getState())

    const doctor = s.doctorFor({
      relayStatus: s.relayStatus,
      // The doctor button is a user click, so turning the switch on is fine; restore() itself never types into Figma.
      startRelay: async () => {
        s.settings.set({ switchOn: true })
        await bridge.restore()
      },
      attachPlugin: async () => ({ message: (await bridge.attachPlugin()).message }),
    })

    registerIpc({
      bridge,
      updates,
      getSettings: () => ({ launchAtLogin: s.settings.get().launchAtLogin }),
      setSettings: (patch) => {
        const next = s.settings.set(patch)
        applyLoginItem(next.launchAtLogin)
        return { launchAtLogin: next.launchAtLogin }
      },
      runDoctor: (fix): Promise<DoctorReport> => doctor.run({ fix }),
      runAiDoctor: () => s.aiDoctor(doctor),
      installHarness: s.installHarness,
      loginHarness: (id) => s.loginHarness(id, (url) => shell.openExternal(url)),
    })

    app.on('second-instance', (_event, argv) => {
      const incoming = parseCliArgs(argv.slice(1))
      if (incoming.mode !== 'gui') return
      if (!incoming.hidden) win.show()
      void bridge.restore()
    })
    app.on('before-quit', () => {
      win.allowClose()
      void s.relay.stop()
    })

    applyLoginItem(s.settings.get().launchAtLogin)

    // Restore never starts Figma, focuses it or sends keys; the plugin is attached only from a button.
    await bridge.restore()
    // Failure only shows up as the update state; it must not block the app.
    void updates.check()

    let polling = false
    setInterval(() => {
      if (polling) return
      polling = true
      bridge
        .refresh()
        .catch(() => undefined)
        .finally(() => (polling = false))
    }, 1000)
  })
}

if (cli.mode === 'mcp') {
  // Do not enter GUI initialization or acquire its single-instance lock. Set
  // Node mode ourselves: client launchers do not reliably forward registered env.
  const root = app.isPackaged ? join(process.resourcesPath, 'app.asar.unpacked') : app.getAppPath()
  const server = join(root, 'resources', 'mcp-stdio.cjs')
  const modeIndex = process.argv.findIndex((arg) => arg === '--mcp' || /[\\/]cursor-talk-to-figma-mcp[\\/]dist[\\/]server\.js$/i.test(arg))
  // Electron's browser process does not expose a usable stdin on Windows. Pass
  // the original handles directly to the Node child rather than reading/piping.
  const child = spawn(process.execPath, [server, ...process.argv.slice(modeIndex + 1)], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: 'inherit',
    windowsHide: true,
  })
  child.once('error', (e) => finish(e.message, 1, process.stderr))
  child.once('exit', (code) => app.exit(code ?? 1))
} else if (cli.mode === 'gui') runGui(cli)
else runHeadless(cli.mode)
