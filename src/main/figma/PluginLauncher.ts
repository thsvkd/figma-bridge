import { pluginMessages as m } from '../messages'
import type { RelayStatus } from '../relay/Relay'
import type { FigmaDriver } from './FigmaDriver'
import { timings } from './timings'

export type LaunchOutcome =
  | 'already'
  | 'quick-action'
  | 'run-last'
  | 'needs-install'
  | 'no-figma'
  | 'no-window'
  | 'no-focus'
  | 'no-relay'

export interface LaunchResult {
  outcome: LaunchOutcome
  detail: string
}

interface Deps {
  driver: FigmaDriver
  relayStatus: () => RelayStatus | null
  pluginName: string
  pluginUrl: string
  sleep?: (ms: number) => Promise<void>
  timeouts?: { window: number; attach: number; poll: number }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

// Attaches the Figma plugin to the relay following spec 5.3: each step runs only if the previous one did not attach.
export class PluginLauncher {
  private inflight: Promise<LaunchResult> | null = null
  private readonly sleep: (ms: number) => Promise<void>
  private readonly timeouts: { window: number; attach: number; poll: number }

  constructor(private readonly deps: Deps) {
    this.sleep = deps.sleep ?? defaultSleep
    this.timeouts = deps.timeouts ?? {
      window: timings.windowTimeoutMs,
      attach: timings.attachTimeoutMs,
      poll: timings.attachPollMs,
    }
  }

  /** Concurrent calls share the run in flight, so a double click sends keys once. */
  attach(): Promise<LaunchResult> {
    this.inflight ??= this.run().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private joined(): boolean {
    return (this.deps.relayStatus()?.figmaJoined ?? 0) > 0
  }

  // Elapsed time is the sum of sleeps, so an injected sleep makes the bound deterministic.
  private async waitUntil(cond: () => boolean, timeoutMs: number, intervalMs: number): Promise<boolean> {
    for (let elapsed = 0; ; elapsed += intervalMs) {
      if (cond()) return true
      if (elapsed >= timeoutMs) return false
      await this.sleep(intervalMs)
    }
  }

  private async focusWithRetry(): Promise<boolean> {
    const { driver } = this.deps
    return (await driver.focus()) || (await driver.focus())
  }

  /** Focuses Figma, sends one input and waits for the plugin. Returns a failure result or whether it attached. */
  private async tryInput(send: () => Promise<void>): Promise<LaunchResult | boolean> {
    if (!(await this.focusWithRetry())) return { outcome: 'no-focus', detail: m.noFocus }
    try {
      await send()
    } catch {
      // The driver rejects when focus leaves Figma midway; stop sending anything else.
      return { outcome: 'no-focus', detail: m.focusLost }
    }
    return this.waitUntil(() => this.joined(), this.timeouts.attach, this.timeouts.poll)
  }

  private async run(): Promise<LaunchResult> {
    const { driver, pluginName, pluginUrl } = this.deps
    if (!this.deps.relayStatus()) return { outcome: 'no-relay', detail: m.noRelay }
    if (this.joined()) return { outcome: 'already', detail: m.already }
    if (!driver.isInstalled()) return { outcome: 'no-figma', detail: m.noFigma }

    const caller = driver.captureForeground()
    try {
      if (!(await driver.isRunning())) await driver.launch()
      if (!(await driver.waitForWindow(this.timeouts.window))) return { outcome: 'no-window', detail: m.noWindow }

      const quick = await this.tryInput(() => driver.sendQuickAction(pluginName))
      if (quick === true) return { outcome: 'quick-action', detail: m.quickAction }
      if (quick !== false) return quick

      const last = await this.tryInput(() => driver.sendRunLast())
      if (last === true) return { outcome: 'run-last', detail: m.runLast }
      if (last !== false) return last

      await driver.openPluginPage(pluginUrl)
      return { outcome: 'needs-install', detail: m.needsInstall }
    } finally {
      driver.restoreForeground(caller)
    }
  }
}
