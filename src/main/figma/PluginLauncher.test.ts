import { describe, expect, it } from 'vitest'
import { createFakeDriver, type FakeState } from './fakeDriver'
import { PluginLauncher } from './PluginLauncher'

const NAME = 'Talk To Figma MCP Plugin'
const URL = 'https://www.figma.com/community/plugin/1485687494525374295/talk-to-figma-mcp-plugin'

function setup(init: Partial<FakeState> = {}, onSleep?: (n: number) => void) {
  const fake = createFakeDriver(init)
  let sleeps = 0
  const launcher = new PluginLauncher({
    driver: fake.driver,
    relayStatus: fake.relayStatus,
    pluginName: NAME,
    pluginUrl: URL,
    sleep: async () => {
      sleeps++
      onSleep?.(sleeps)
    },
    timeouts: { window: 5000, attach: 1000, poll: 250 },
  })
  return { ...fake, launcher, sleeps: () => sleeps }
}

describe('PluginLauncher', () => {
  it('already: plugin joined means no launch, focus, input or capture', async () => {
    const f = setup({ figmaJoined: 1 })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('already')
    expect(r.detail).toBeTruthy()
    expect(f.inputCount()).toBe(0)
    expect(f.count('captureForeground')).toBe(0)
    expect(f.count('restoreForeground')).toBe(0)
  })

  it('no-relay: relay down means no input at all', async () => {
    const f = setup({ relayUp: false })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-relay')
    expect(f.inputCount()).toBe(0)
    expect(f.count('captureForeground')).toBe(0)
  })

  it('no-figma: Figma not installed means no input at all', async () => {
    const f = setup({ installed: false })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-figma')
    expect(f.inputCount()).toBe(0)
    expect(f.count('captureForeground')).toBe(0)
  })

  it('launches Figma when not running and waits for its window', async () => {
    const f = setup({ running: false, joinOn: 'quick-action' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('quick-action')
    expect(f.calls.indexOf('launch')).toBeLessThan(f.calls.indexOf('waitForWindow:5000'))
    expect(f.calls.indexOf('waitForWindow:5000')).toBeLessThan(f.calls.indexOf('focus'))
  })

  it('does not launch Figma again when it is already running', async () => {
    const f = setup({ running: true, joinOn: 'quick-action' })
    await f.launcher.attach()
    expect(f.count('launch')).toBe(0)
  })

  it('ends with no-window (not no-focus) when the window never appears, sending nothing', async () => {
    const f = setup({ running: false, windowAppears: false })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-window')
    expect(r.detail).toBeTruthy()
    expect(f.count('focus')).toBe(0)
    expect(f.count('sendQuickAction') + f.count('sendRunLast') + f.count('openPluginPage')).toBe(0)
    expect(f.restored).toEqual([4242])
  })

  it('quick-action: joining after the quick action stops there', async () => {
    const f = setup({ joinOn: 'quick-action' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('quick-action')
    expect(f.calls).toContain(`sendQuickAction:${NAME}`)
    expect(f.count('sendRunLast')).toBe(0)
    expect(f.count('openPluginPage')).toBe(0)
  })

  it('polls the relay until the plugin joins within the attach limit', async () => {
    let fake: ReturnType<typeof setup> | undefined
    const f = setup({}, (n) => {
      // Join on the third poll after the quick action was sent.
      if (n === 3 && fake!.count('sendQuickAction') === 1) fake!.state.figmaJoined = 1
    })
    fake = f
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('quick-action')
    expect(f.sleeps()).toBe(3)
    expect(f.count('sendRunLast')).toBe(0)
  })

  it('run-last: falls back to rerunning the last plugin', async () => {
    const f = setup({ joinOn: 'run-last' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('run-last')
    expect(f.count('sendQuickAction')).toBe(1)
    expect(f.count('sendRunLast')).toBe(1)
    expect(f.count('openPluginPage')).toBe(0)
    // Each wait is bounded by attach / poll = 4 polls.
    expect(f.sleeps()).toBe(4)
  })

  it('needs-install: opens the plugin page once, then a second attach after install is already', async () => {
    const f = setup({ joinOn: null })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('needs-install')
    expect(f.calls.filter((c) => c === `openPluginPage:${URL}`)).toHaveLength(1)

    f.state.figmaJoined = 1
    const before = f.calls.length
    const again = await f.launcher.attach()
    expect(again.outcome).toBe('already')
    const after = f.calls.slice(before)
    expect(after.filter((c) => /^(launch|focus|send|openPluginPage|captureForeground)/.test(c))).toEqual([])
  })

  it('no-focus: two failed focus attempts send no input', async () => {
    const f = setup({ focusDefault: false })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-focus')
    expect(f.count('focus')).toBe(2)
    expect(f.count('sendQuickAction') + f.count('sendRunLast') + f.count('openPluginPage')).toBe(0)
    expect(f.restored).toEqual([4242])
  })

  it('retries focus once and proceeds when the second attempt succeeds', async () => {
    const f = setup({ focusResults: [false, true], joinOn: 'quick-action' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('quick-action')
    expect(f.count('focus')).toBe(2)
  })

  it('no-focus: losing focus during the quick action stops all further input', async () => {
    const f = setup({ loseFocusOn: 'quick-action', joinOn: 'run-last' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-focus')
    expect(f.count('sendRunLast')).toBe(0)
    expect(f.count('openPluginPage')).toBe(0)
    expect(f.restored).toEqual([4242])
  })

  it('no-focus: losing focus during run-last does not open the plugin page', async () => {
    const f = setup({ loseFocusOn: 'run-last' })
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('no-focus')
    expect(f.count('openPluginPage')).toBe(0)
  })

  it('restores the captured foreground window in every outcome that touched Figma', async () => {
    for (const init of [
      { joinOn: 'quick-action' },
      { joinOn: 'run-last' },
      { joinOn: null },
      { focusDefault: false },
    ] as Array<Partial<FakeState>>) {
      const f = setup({ ...init, foregroundHandle: 77 })
      await f.launcher.attach()
      expect(f.count('captureForeground')).toBe(1)
      expect(f.restored).toEqual([77])
      expect(f.calls.indexOf('captureForeground')).toBeLessThan(f.calls.findIndex((c) => c === 'focus'))
    }
  })

  it('restores the foreground even when the driver throws', async () => {
    const f = setup({ running: false, launchError: 'spawn failed' })
    await expect(f.launcher.attach()).rejects.toThrow('spawn failed')
    expect(f.restored).toEqual([4242])
  })

  it('concurrent attach calls share one run and one quick action', async () => {
    const f = setup({ joinOn: 'quick-action' })
    const [a, b, c] = await Promise.all([f.launcher.attach(), f.launcher.attach(), f.launcher.attach()])
    expect(f.count('sendQuickAction')).toBe(1)
    expect(f.count('captureForeground')).toBe(1)
    expect(a).toBe(b)
    expect(b).toBe(c)
    expect(a.outcome).toBe('quick-action')
  })

  it('returns the same promise while a run is in flight and a fresh run afterwards', async () => {
    const f = setup({ joinOn: 'quick-action' })
    const p1 = f.launcher.attach()
    const p2 = f.launcher.attach()
    expect(p1).toBe(p2)
    await p1
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('already')
  })

  it('a failed run does not block the next attach', async () => {
    const f = setup({ running: false, launchError: 'spawn failed' })
    await expect(f.launcher.attach()).rejects.toThrow()
    f.state.launchError = null
    f.state.joinOn = 'quick-action'
    const r = await f.launcher.attach()
    expect(r.outcome).toBe('quick-action')
  })
})
