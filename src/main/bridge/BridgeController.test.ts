import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { BridgeState, HarnessState } from '../../shared/types'
import type { LaunchResult } from '../figma/PluginLauncher'
import type { McpLaunch } from '../mcp/launch'
import { PortInUseError, type RelayStatus } from '../relay/Relay'
import { SettingsStore } from '../settings'
import { BridgeController } from './BridgeController'

const LAUNCH: McpLaunch = { command: 'C:\\app\\figma-bridge.exe', args: ['server.js'], env: { ELECTRON_RUN_AS_NODE: '1' } }
const HARNESS: HarnessState[] = [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }]

let dir: string
let settings: SettingsStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fb-bridge-'))
  settings = new SettingsStore(join(dir, 'settings.json'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

function setup(opts: { startError?: Error; ensureErrors?: string[]; attachJoins?: boolean; attachOutcome?: LaunchResult; attachError?: Error } = {}) {
  const calls: string[] = []
  const emitted: BridgeState[] = []
  let running = false
  let figmaJoined = 0
  let registered = false
  let startGate: Promise<void> | null = null

  const relay = {
    get running() {
      return running
    },
    async start() {
      calls.push('relay.start')
      if (startGate) await startGate
      if (opts.startError) throw opts.startError
      running = true
    },
    async stop() {
      calls.push('relay.stop')
      running = false
      figmaJoined = 0
    },
    status(): RelayStatus {
      return {
        relay: 'figma-bridge',
        ok: true,
        port: 3055,
        startedAt: '',
        figma: figmaJoined,
        harness: 0,
        figmaJoined,
        harnessJoined: 0,
        ready: figmaJoined > 0,
        channels: [],
      }
    },
  }
  const registry = {
    async ensure(l: McpLaunch) {
      calls.push('registry.ensure')
      expect(l).toEqual(LAUNCH)
      const changed = !registered
      registered = true
      const errs = (opts.ensureErrors ?? []).map((error) => ({ id: 'codex' as const, changed: false, error }))
      return [{ id: 'claude' as const, changed }, ...errs]
    },
    async list() {
      calls.push('registry.list')
      return HARNESS
    },
  }
  const launcher = {
    async attach(): Promise<LaunchResult> {
      calls.push('launcher.attach')
      if (opts.attachError) throw opts.attachError
      if (figmaJoined > 0) return { outcome: 'already', detail: '이미 연결됨' }
      if (opts.attachOutcome) return opts.attachOutcome
      if (opts.attachJoins ?? true) {
        figmaJoined = 1
        return { outcome: 'quick-action', detail: '퀵 액션' }
      }
      return { outcome: 'needs-install', detail: '설치 필요' }
    },
  }
  const ctl = new BridgeController({
    relay,
    registry,
    launch: () => LAUNCH,
    launcher,
    settings,
    env: { figmaInstalled: () => true, figmaRunning: async () => true },
    emit: (s) => emitted.push(s),
  })
  return {
    ctl,
    calls,
    emitted,
    actions: () => calls.filter((c) => c !== 'registry.list'),
    setJoined: (n: number) => {
      figmaJoined = n
    },
    gateStart: () => {
      let open!: () => void
      startGate = new Promise<void>((r) => (open = r))
      return () => {
        startGate = null
        open()
      }
    },
  }
}

describe('status derivation', () => {
  it('is off while the switch is off', async () => {
    const { ctl } = setup()
    expect((await ctl.refresh()).status).toBe('off')
    expect(ctl.getState().switchOn).toBe(false)
  })

  it('is relay-only when the relay runs without the plugin, connected once it joins, and back when it leaves', async () => {
    const t = setup({ attachJoins: false })
    expect((await t.ctl.turnOn()).status).toBe('relay-only')
    t.setJoined(1)
    expect((await t.ctl.refresh()).status).toBe('connected')
    t.setJoined(0)
    expect((await t.ctl.refresh()).status).toBe('relay-only')
  })

  it('reports figma and harness facts', async () => {
    const t = setup()
    const s = await t.ctl.turnOn()
    expect(s).toMatchObject({ switchOn: true, status: 'connected', busy: false, figmaInstalled: true, figmaRunning: true, harness: HARNESS })
  })
})

describe('turnOn', () => {
  it('runs relay.start, registry.ensure, launcher.attach in order and saves the switch', async () => {
    const t = setup()
    const s = await t.ctl.turnOn()
    expect(t.actions()).toEqual(['relay.start', 'registry.ensure', 'launcher.attach'])
    expect(settings.get().switchOn).toBe(true)
    expect(s.status).toBe('connected')
  })

  it('is idempotent when already on and connected', async () => {
    const t = setup()
    const first = await t.ctl.turnOn()
    const second = await t.ctl.turnOn()
    // Only the launcher detail differs ('already' on the second run).
    expect({ ...second, message: undefined }).toEqual({ ...first, message: undefined })
    expect(second.message).toBe('이미 연결됨')
    expect(t.actions()).toEqual(['relay.start', 'registry.ensure', 'launcher.attach', 'relay.start', 'registry.ensure', 'launcher.attach'])
    expect(settings.get().switchOn).toBe(true)
  })

  it('does not save the switch and reports the cause in Korean when port 3055 is taken', async () => {
    const t = setup({ startError: new PortInUseError(3055) })
    const s = await t.ctl.turnOn()
    expect(s.status).toBe('off')
    expect(s.switchOn).toBe(false)
    expect(s.message).toMatch(/3055/)
    expect(s.message).toMatch(/[가-힣]/)
    expect(t.actions()).toEqual(['relay.start'])
    expect(settings.get().switchOn).toBe(false)
  })

  it('keeps going when some harnesses fail and summarizes them in the message', async () => {
    const t = setup({ ensureErrors: ['Codex에 등록하지 못했습니다'] })
    const s = await t.ctl.turnOn()
    expect(t.actions()).toEqual(['relay.start', 'registry.ensure', 'launcher.attach'])
    expect(s.status).toBe('connected')
    expect(s.message).toContain('Codex에 등록하지 못했습니다')
    expect(settings.get().switchOn).toBe(true)
  })

  it('stays on as relay-only with the launcher detail when the plugin does not attach', async () => {
    const t = setup({ attachJoins: false })
    const s = await t.ctl.turnOn()
    expect(s).toMatchObject({ switchOn: true, status: 'relay-only', message: '설치 필요' })
    expect(settings.get().switchOn).toBe(true)
  })

  it('emits busy:true while running and a final non-busy state', async () => {
    const t = setup()
    await t.ctl.turnOn()
    expect(t.emitted[0].busy).toBe(true)
    expect(t.emitted.at(-1)).toMatchObject({ busy: false, status: 'connected' })
  })

  it('runs once when called twice at the same time', async () => {
    const t = setup()
    const open = t.gateStart()
    const a = t.ctl.turnOn()
    const b = t.ctl.turnOn()
    expect(t.ctl.getState().busy).toBe(true)
    open()
    const [sa, sb] = await Promise.all([a, b])
    expect(sa).toEqual(sb)
    expect(t.actions()).toEqual(['relay.start', 'registry.ensure', 'launcher.attach'])
  })
})

describe('restore', () => {
  it('starts the relay and ensures MCP but never attaches the plugin', async () => {
    settings.set({ switchOn: true })
    const t = setup()
    const s = await t.ctl.restore()
    expect(t.actions()).toEqual(['relay.start', 'registry.ensure'])
    expect(s.status).toBe('relay-only')
  })

  it('shows connected when the plugin re-joins on its own', async () => {
    settings.set({ switchOn: true })
    const t = setup()
    t.setJoined(1)
    expect((await t.ctl.restore()).status).toBe('connected')
  })

  it('does nothing when the saved switch is off', async () => {
    const t = setup()
    const s = await t.ctl.restore()
    expect(t.actions()).toEqual([])
    expect(s.status).toBe('off')
  })

  it('keeps the saved switch when the port is taken', async () => {
    settings.set({ switchOn: true })
    const t = setup({ startError: new PortInUseError(3055) })
    const s = await t.ctl.restore()
    expect(s.status).toBe('off')
    expect(s.message).toMatch(/3055/)
    expect(settings.get().switchOn).toBe(true)
  })
})

describe('turnOff', () => {
  it('stops the relay, saves false and leaves the registry alone', async () => {
    const t = setup()
    await t.ctl.turnOn()
    t.calls.length = 0
    const s = await t.ctl.turnOff()
    expect(t.actions()).toEqual(['relay.stop'])
    expect(settings.get().switchOn).toBe(false)
    expect(s).toMatchObject({ switchOn: false, status: 'off' })
  })

  it('gives the same results across three off/on cycles', async () => {
    const t = setup()
    const ons: BridgeState[] = []
    const offs: BridgeState[] = []
    for (let i = 0; i < 3; i++) {
      ons.push(await t.ctl.turnOn())
      offs.push(await t.ctl.turnOff())
    }
    expect(new Set(ons.map((s) => JSON.stringify(s))).size).toBe(1)
    expect(new Set(offs.map((s) => JSON.stringify(s))).size).toBe(1)
    expect(offs[0]).toMatchObject({ switchOn: false, status: 'off' })
  })
})

describe('attachPlugin', () => {
  it('attaches without touching relay or registry', async () => {
    settings.set({ switchOn: true })
    const t = setup()
    await t.ctl.restore()
    t.calls.length = 0
    const s = await t.ctl.attachPlugin()
    expect(t.actions()).toEqual(['launcher.attach'])
    expect(s.status).toBe('connected')
    expect(s.message).toBe('퀵 액션')
  })
})

describe('launcher errors', () => {
  const throwing = () => setup({ attachError: new Error('boom') })

  it('turnOn still saves the switch and reports the attach error', async () => {
    const t = throwing()
    const s = await t.ctl.turnOn()
    expect(s).toMatchObject({ switchOn: true, status: 'relay-only', busy: false })
    expect(s.message).toMatch(/플러그인.*boom/)
    expect(settings.get().switchOn).toBe(true)
  })

  it('attachPlugin reports the attach error and clears busy', async () => {
    settings.set({ switchOn: true })
    const t = throwing()
    await t.ctl.restore()
    const s = await t.ctl.attachPlugin()
    expect(s).toMatchObject({ status: 'relay-only', busy: false })
    expect(s.message).toMatch(/플러그인.*boom/)
  })
})

describe('refresh', () => {
  it('emits only when the state changes', async () => {
    const t = setup({ attachJoins: false })
    await t.ctl.turnOn()
    const n = t.emitted.length
    await t.ctl.refresh()
    expect(t.emitted.length).toBe(n)
    t.setJoined(1)
    await t.ctl.refresh()
    expect(t.emitted.length).toBe(n + 1)
  })
})
