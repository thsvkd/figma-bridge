import { spawn } from 'node:child_process'
import { appendFileSync, mkdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { get } from 'node:http'
import { dirname, join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import type { AiDoctorReport, HarnessId, HarnessInstallReport } from '@shared/types'
import { BridgeController } from './bridge/BridgeController'
import { Doctor, type DoctorResult } from './doctor/Doctor'
import { runAiDoctor } from './doctor/aiDoctor'
import { installHarness, shouldRegisterAfterInstall, startHarnessLogin } from './doctor/harnessInstall'
import { findFigmaPath, listFigmaPids, createWin32FigmaDriver } from './figma/win32'
import { PluginLauncher } from './figma/PluginLauncher'
import { buildLaunch, type McpLaunch } from './mcp/launch'
import { createTargets, McpRegistry } from './mcp/McpRegistry'
import { createPaths } from './paths'
import { Relay, type RelayStatus } from './relay/Relay'
import { listeningPids, startWithLegacyCleanup, stopLegacyRelay } from './relay/legacyRelay'
import { SettingsStore } from './settings'
import { createFindCommand, createHarnessFinder, download, runCli, runProcess, spawnVisible } from './system'

export const RELAY_PORT = 3055
export const PLUGIN_NAME = 'Talk To Figma MCP Plugin'
// The AI doctor and the winget/script installs legitimately run for minutes; everything else keeps the 30 s default.
const AI_DOCTOR_TIMEOUT_MS = 15 * 60_000
const INSTALL_TIMEOUT_MS = 10 * 60_000
export const PLUGIN_URL = 'https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin'

export interface ServiceOptions {
  exePath: string
  resourcesPath: string
  /** app.getAppPath(): the asar when packaged, the project root in dev. */
  appPath: string
  isPackaged: boolean
}

/** Reads /status from a relay that may live in another process (the running GUI). */
export function fetchRelayStatus(port = RELAY_PORT): Promise<RelayStatus | null> {
  return new Promise((resolve) => {
    const req = get({ host: '127.0.0.1', port, path: '/status', timeout: 1500 }, (res) => {
      let body = ''
      res.setEncoding('utf8').on('data', (d: string) => (body += d))
      res.on('end', () => {
        try {
          const data = JSON.parse(body) as RelayStatus
          resolve(data.relay === 'figma-bridge' ? data : null)
        } catch {
          resolve(null)
        }
      })
    })
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

// Real implementation of every boundary; the GUI and the headless CLI modes both build on this.
export function createServices(opts: ServiceOptions) {
  const paths = createPaths()
  const settings = new SettingsStore(paths.settingsFile)
  const logFile = join(paths.logDir, 'app.log')
  const log = (line: string) => {
    try {
      mkdirSync(paths.logDir, { recursive: true })
      appendFileSync(logFile, `${new Date().toISOString()} ${line}\n`)
    } catch {
      // Logging must never break the app.
    }
  }

  const relay = new Relay({ port: RELAY_PORT, log })
  const relayStatus = (): RelayStatus | null => (relay.running ? relay.status() : null)

  const stopLegacy = () =>
    stopLegacyRelay({
      port: RELAY_PORT,
      home: paths.home,
      fetchStatus: fetchRelayStatus,
      readPidFile: (file) => readFile(file, 'utf8').catch(() => null),
      imageNameOf: async (pid) => {
        const out = (await runProcess('tasklist.exe', ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'])).stdout
        const row = /^"([^"]+)","(\d+)"/m.exec(out)
        return row && Number(row[2]) === pid ? row[1] : null
      },
      listenerPids: async (port) => listeningPids((await runProcess('netstat.exe', ['-ano', '-p', 'TCP'])).stdout, port),
      kill: async (pid) => void process.kill(pid),
      currentPid: process.pid,
      sleep: (ms) => sleep(ms),
    }).then((stopped) => {
      if (stopped) log('Stopped a relay left over from the previous app version')
      return stopped
    })
  // The bridge starts the relay through this wrapper so a leftover relay from the old app cannot block it.
  const bridgeRelay = {
    start: () => startWithLegacyCleanup(() => relay.start(), stopLegacy),
    stop: () => relay.stop(),
    status: () => relay.status(),
    get running() {
      return relay.running
    },
  }

  const findCommand = createFindCommand()
  const findHarness = createHarnessFinder(paths, findCommand)
  const registry = new McpRegistry(createTargets({ paths, runCli, findCommand }))
  const launch = (): McpLaunch => {
    const l = buildLaunch({ exePath: opts.exePath, resourcesPath: opts.resourcesPath })
    // In dev the MCP package is not unpacked next to the electron binary, so point at node_modules.
    return opts.isPackaged
      ? l
      : { ...l, args: [join(opts.appPath, 'node_modules', 'cursor-talk-to-figma-mcp', 'dist', 'server.js')] }
  }

  const driver = createWin32FigmaDriver({
    figmaPath: () => findFigmaPath(paths.figmaCandidates),
    spawn,
    listFigmaPids,
  })
  const launcher = new PluginLauncher({ driver, relayStatus, pluginName: PLUGIN_NAME, pluginUrl: PLUGIN_URL })

  const bridge = (emit: ConstructorParameters<typeof BridgeController>[0]['emit']) =>
    new BridgeController({
      relay: bridgeRelay,
      registry,
      launch,
      launcher,
      settings,
      env: { figmaInstalled: () => driver.isInstalled(), figmaRunning: () => driver.isRunning() },
      emit,
    })

  const connectHarness = async () => {
    const errors = (await registry.ensure(launch())).flatMap((r) => (r.error ? [r.error] : []))
    if (errors.length) throw new Error(errors.join(' / '))
  }

  const installDeps = {
    findCommand: findHarness,
    runProcess: async (file: string, args: string[]) => ({ code: (await runProcess(file, args, { timeoutMs: INSTALL_TIMEOUT_MS })).code }),
    download,
  }

  const installAndReport = async (id: HarnessId): Promise<HarnessInstallReport> => {
    const r = await installHarness(id, installDeps)
    // Registration errors surface in the harness list; the install itself still succeeded.
    if (shouldRegisterAfterInstall(r)) await registry.ensure(launch())
    return { ok: r.ok, detail: r.detail, manualUrl: r.manualUrl, needsLogin: r.needsLogin }
  }

  const doctorFor = (d: {
    relayStatus: () => RelayStatus | null
    startRelay: () => Promise<void>
    attachPlugin: () => Promise<{ message?: string }>
  }) =>
    new Doctor({
      ...d,
      figma: driver,
      listHarness: () => registry.list(launch()),
      connectHarness,
      installHarness: async () => (await installHarness('claude', installDeps)).detail,
    })

  const aiDoctor = async (doctor: Doctor): Promise<AiDoctorReport> => {
    // The AI step never types into Figma: the deterministic pass runs without input and the AI only gets
    // `--status` and `--doctor-fix`, which do not touch Figma either.
    const before: DoctorResult = await doctor.run({ fix: true, figmaInput: false })
    const r = await runAiDoctor(before, {
      findCommand,
      runProcess: (file, args, o) => runProcess(file, args, { ...o, timeoutMs: AI_DOCTOR_TIMEOUT_MS }),
      writeFile: async (file, text) => {
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, text)
      },
      readTemplate: () => readFile(join(opts.appPath, 'resources', 'ai-doctor.md'), 'utf8'),
      doctor: () => doctor.run(),
      exePath: opts.exePath,
      home: paths.home,
      logDir: paths.logDir,
      pluginUrl: PLUGIN_URL,
    })
    return { harness: r.harness, exitCode: r.exitCode, output: r.output, after: r.after }
  }

  const loginHarness = (id: HarnessId, openUrl: (url: string) => Promise<void>) =>
    startHarnessLogin(id, { findCommand: findHarness, spawnVisible, openUrl })

  return {
    paths,
    settings,
    relay,
    relayStatus,
    registry,
    launch,
    driver,
    bridge,
    doctorFor,
    aiDoctor,
    installHarness: installAndReport,
    loginHarness,
    log,
  }
}

export type Services = ReturnType<typeof createServices>
