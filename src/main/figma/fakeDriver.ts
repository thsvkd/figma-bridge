import type { RelayStatus } from '../relay/Relay'
import type { FigmaDriver } from './FigmaDriver'

// Test double for FigmaDriver plus a matching relay status source. Every driver call is recorded in `calls`.
export interface FakeState {
  relayUp: boolean
  figmaJoined: number
  installed: boolean
  running: boolean
  windowAppears: boolean
  /** Results of successive focus() calls; when empty, focus() returns `focusDefault`. */
  focusResults: boolean[]
  focusDefault: boolean
  foreground: boolean
  /** Which input makes the plugin join the relay. */
  joinOn: 'quick-action' | 'run-last' | null
  /** Focus moves to another window right after the first key of this input, so the input rejects. */
  loseFocusOn: 'quick-action' | 'run-last' | null
  /** Rejects launch() with this message. */
  launchError: string | null
  foregroundHandle: number
}

export function createFakeDriver(init: Partial<FakeState> = {}) {
  const state: FakeState = {
    relayUp: true,
    figmaJoined: 0,
    installed: true,
    running: true,
    windowAppears: true,
    focusResults: [],
    focusDefault: true,
    foreground: false,
    joinOn: null,
    loseFocusOn: null,
    launchError: null,
    foregroundHandle: 4242,
    ...init,
  }
  const calls: string[] = []
  const restored: number[] = []

  const send = async (kind: 'quick-action' | 'run-last') => {
    if (!state.foreground) throw new Error('Figma is not foreground')
    if (state.loseFocusOn === kind) {
      state.foreground = false
      throw new Error('Focus left Figma')
    }
    // Yield so concurrent callers interleave like the real driver would.
    await Promise.resolve()
    if (state.joinOn === kind) state.figmaJoined = 1
  }

  const driver: FigmaDriver = {
    isInstalled: () => {
      calls.push('isInstalled')
      return state.installed
    },
    isRunning: async () => {
      calls.push('isRunning')
      return state.running
    },
    launch: async () => {
      calls.push('launch')
      if (state.launchError) throw new Error(state.launchError)
      state.running = true
    },
    waitForWindow: async (timeoutMs) => {
      calls.push(`waitForWindow:${timeoutMs}`)
      return state.running && state.windowAppears
    },
    focus: async () => {
      calls.push('focus')
      const ok = state.focusResults.length > 0 ? state.focusResults.shift()! : state.focusDefault
      state.foreground = ok
      return ok
    },
    isFigmaForeground: () => state.foreground,
    sendQuickAction: async (pluginName) => {
      calls.push(`sendQuickAction:${pluginName}`)
      await send('quick-action')
    },
    sendRunLast: async () => {
      calls.push('sendRunLast')
      await send('run-last')
    },
    openPluginPage: async (url) => {
      calls.push(`openPluginPage:${url}`)
    },
    captureForeground: () => {
      calls.push('captureForeground')
      return state.foregroundHandle
    },
    restoreForeground: (handle) => {
      calls.push('restoreForeground')
      restored.push(handle)
      state.foreground = false
    },
  }

  const relayStatus = (): RelayStatus | null =>
    state.relayUp
      ? {
          relay: 'figma-bridge',
          ok: true,
          port: 3055,
          startedAt: '2026-10-16T00:00:00.000Z',
          figma: state.figmaJoined,
          harness: 1,
          figmaJoined: state.figmaJoined,
          harnessJoined: 1,
          ready: state.figmaJoined > 0,
          channels: [],
        }
      : null

  const count = (prefix: string) => calls.filter((c) => c.startsWith(prefix)).length
  const inputCount = () =>
    count('launch') + count('focus') + count('sendQuickAction') + count('sendRunLast') + count('openPluginPage')

  return { driver, relayStatus, state, calls, restored, count, inputCount }
}
