import { describe, expect, it } from 'vitest'
import type { HarnessState } from '@shared/types'
import { Doctor, type Check } from './Doctor'

function relayStatus(figmaJoined: number) {
  return {
    relay: 'figma-bridge' as const,
    ok: true as const,
    port: 3055,
    startedAt: '',
    figma: figmaJoined,
    harness: 0,
    figmaJoined,
    harnessJoined: 0,
    ready: false,
    channels: [],
  }
}

interface World {
  relayUp: boolean
  plugin: boolean
  figmaInstalled: boolean
  figmaRunning: boolean
  harness: HarnessState[]
}

const h = (id: HarnessState['id'], installed: boolean, registered: boolean): HarnessState => ({
  id,
  name: id,
  installed,
  registered,
})

function setup(init: Partial<World> = {}) {
  const w: World = {
    relayUp: true,
    plugin: true,
    figmaInstalled: true,
    figmaRunning: true,
    harness: [h('claude', true, true), h('claude-desktop', false, false), h('codex', true, true)],
    ...init,
  }
  const calls: string[] = []
  const doctor = new Doctor({
    relayStatus: () => (w.relayUp ? relayStatus(w.plugin ? 1 : 0) : null),
    startRelay: async () => {
      calls.push('start-relay')
      w.relayUp = true
    },
    figma: {
      isInstalled: () => w.figmaInstalled,
      isRunning: async () => w.figmaRunning,
      launch: async () => {
        calls.push('start-figma')
        w.figmaRunning = true
      },
    },
    listHarness: async () => w.harness.map((x) => ({ ...x })),
    connectHarness: async () => {
      calls.push('connect-harness')
      w.harness = w.harness.map((x) => (x.installed ? { ...x, registered: true } : x))
    },
    attachPlugin: async () => {
      calls.push('attach-plugin')
      w.plugin = true
      return { message: 'attached' }
    },
    installHarness: async () => {
      calls.push('install-harness')
      w.harness = w.harness.map((x) => (x.id === 'claude' ? { ...x, installed: true } : x))
      return 'installed'
    },
  })
  return { w, doctor, calls }
}

const byId = (checks: Check[], id: string) => checks.find((c) => c.id === id)

describe('Doctor checks', () => {
  it('healthy state: everything ok, nothing to fix', async () => {
    const { doctor } = setup()
    const r = await doctor.run()
    expect(r.ok).toBe(true)
    expect(r.checks.every((c) => c.status === 'ok')).toBe(true)
    expect(r.applied).toEqual([])
  })

  it('relay down is fail with start-relay', async () => {
    const { doctor } = setup({ relayUp: false })
    const c = byId((await doctor.run()).checks, 'relay')!
    expect(c.status).toBe('fail')
    expect(c.fixId).toBe('start-relay')
  })

  it('figma not installed is fail with a hint and no fix; installed but stopped is warn', async () => {
    const missing = byId((await setup({ figmaInstalled: false }).doctor.run()).checks, 'figma')!
    expect(missing.status).toBe('fail')
    expect(missing.hint).toContain('figma.com/downloads')
    expect(missing.fixId).toBeUndefined()
    const stopped = byId((await setup({ figmaRunning: false }).doctor.run()).checks, 'figma')!
    expect(stopped.status).toBe('warn')
    expect(stopped.fixId).toBe('start-figma')
  })

  it('plugin not joined is warn with attach-plugin', async () => {
    const { doctor } = setup({ plugin: false })
    const c = byId((await doctor.run()).checks, 'plugin')!
    expect(c.status).toBe('warn')
    expect(c.fixId).toBe('attach-plugin')
  })

  it('installed but unregistered tool is fail with connect-harness; missing tool is warn', async () => {
    const { doctor } = setup({
      harness: [h('claude', true, false), h('claude-desktop', false, false), h('codex', false, false)],
    })
    const checks = (await doctor.run()).checks
    expect(byId(checks, 'claude')).toMatchObject({ status: 'fail', fixId: 'connect-harness' })
    expect(byId(checks, 'codex')?.status).toBe('warn')
    expect(byId(checks, 'claude-desktop')).toBeUndefined()
  })

  it('no tool at all adds an install-harness failure', async () => {
    const { doctor } = setup({
      harness: [h('claude', false, false), h('claude-desktop', false, false), h('codex', false, false)],
    })
    const c = byId((await doctor.run()).checks, 'harness-any')!
    expect(c).toMatchObject({ status: 'fail', fixId: 'install-harness' })
  })
})

describe('Doctor fixes', () => {
  it('fix:true runs each fixId once even when several checks share it', async () => {
    const { doctor, calls, w } = setup({
      harness: [h('claude', true, false), h('claude-desktop', true, false), h('codex', true, false)],
    })
    const r = await doctor.run({ fix: true })
    expect(calls.filter((c) => c === 'connect-harness')).toHaveLength(1)
    expect(r.applied).toHaveLength(1)
    expect(r.ok).toBe(true)
    expect(w.harness.every((x) => x.registered)).toBe(true)
  })

  it('fixes the whole broken chain in order and reports the state after fixing', async () => {
    const { doctor, calls } = setup({ relayUp: false, plugin: false, figmaRunning: false })
    const r = await doctor.run({ fix: true })
    expect(calls).toEqual(['start-relay', 'start-figma', 'attach-plugin'])
    expect(r.applied).toHaveLength(3)
    expect(r.ok).toBe(true)
    expect(r.checks.every((c) => c.status === 'ok')).toBe(true)
  })

  it('figmaInput:false never launches Figma or attaches the plugin', async () => {
    const { doctor, calls } = setup({ plugin: false, figmaRunning: false })
    const r = await doctor.run({ fix: true, figmaInput: false })
    expect(calls).toEqual([])
    expect(r.applied).toEqual([])
    expect(byId(r.checks, 'figma')?.status).toBe('warn')
    expect(byId(r.checks, 'plugin')?.status).toBe('warn')
  })

  it('figmaInput:false still fixes the relay and the AI tools', async () => {
    const { doctor, calls } = setup({
      relayUp: false,
      plugin: false,
      harness: [h('claude', true, false), h('claude-desktop', false, false), h('codex', true, true)],
    })
    await doctor.run({ fix: true, figmaInput: false })
    expect(calls).toEqual(['start-relay', 'connect-harness'])
  })

  it('is idempotent: a second fix run on a healthy state applies nothing', async () => {
    const { doctor, calls } = setup({ relayUp: false, plugin: false })
    await doctor.run({ fix: true })
    const before = calls.length
    const again = await doctor.run({ fix: true })
    expect(again.applied).toEqual([])
    expect(calls).toHaveLength(before)
  })

  it('without fix:true nothing is changed', async () => {
    const { doctor, calls } = setup({ relayUp: false })
    const r = await doctor.run()
    expect(calls).toEqual([])
    expect(r.ok).toBe(false)
    expect(r.applied).toEqual([])
  })

  it('a throwing fix is reported in applied and does not stop the others', async () => {
    const w = { relayUp: false, plugin: false }
    const calls: string[] = []
    const doctor = new Doctor({
      relayStatus: () => (w.relayUp ? relayStatus(w.plugin ? 1 : 0) : null),
      startRelay: async () => {
        throw new Error('port busy')
      },
      figma: { isInstalled: () => true, isRunning: async () => true, launch: async () => {} },
      listHarness: async () => [h('claude', true, true)],
      connectHarness: async () => {},
      attachPlugin: async () => {
        calls.push('attach-plugin')
        return {}
      },
      installHarness: async () => '',
    })
    const r = await doctor.run({ fix: true })
    expect(r.applied.some((a) => a.includes('start-relay') && a.includes('port busy'))).toBe(true)
    expect(calls).toContain('attach-plugin')
    expect(r.ok).toBe(false)
  })

  it('install-harness fix installs a tool and then connects it', async () => {
    const { doctor, calls } = setup({
      harness: [h('claude', false, false), h('claude-desktop', false, false), h('codex', false, false)],
    })
    const r = await doctor.run({ fix: true })
    expect(calls).toEqual(['install-harness', 'connect-harness'])
    expect(r.ok).toBe(true)
  })
})
