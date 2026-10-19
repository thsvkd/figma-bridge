import type { BridgeState, BridgeStatus, HarnessState } from '../../shared/types'
import type { PluginLauncher } from '../figma/PluginLauncher'
import type { McpLaunch } from '../mcp/launch'
import type { McpRegistry } from '../mcp/McpRegistry'
import { bridgeMessages as m } from '../messages'
import { PortInUseError, type Relay } from '../relay/Relay'
import type { SettingsStore } from '../settings'

interface Deps {
  relay: Pick<Relay, 'start' | 'stop' | 'status' | 'running'>
  registry: Pick<McpRegistry, 'ensure' | 'list'>
  launch: () => McpLaunch
  launcher: Pick<PluginLauncher, 'attach'>
  settings: SettingsStore
  env: { figmaInstalled(): boolean; figmaRunning(): Promise<boolean> }
  emit: (s: BridgeState) => void
}

type Action = 'turnOn' | 'restore' | 'turnOff' | 'attachPlugin'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// On/off state machine (spec 5.2). Actions run one at a time; a repeated call of the
// action in flight gets that action's promise instead of running it again.
export class BridgeController {
  private state: BridgeState
  private message: string | undefined
  private harness: HarnessState[] = []
  private readonly inflight = new Map<Action, Promise<BridgeState>>()
  private tail: Promise<unknown> = Promise.resolve()

  constructor(private readonly deps: Deps) {
    this.state = {
      switchOn: deps.settings.get().switchOn,
      status: 'off',
      busy: false,
      figmaInstalled: deps.env.figmaInstalled(),
      figmaRunning: false,
      harness: [],
    }
  }

  getState(): BridgeState {
    return this.state
  }

  /** User action: relay, MCP entries, then the plugin. The switch is saved only once the relay is up. */
  turnOn(): Promise<BridgeState> {
    return this.run('turnOn', async () => {
      const notes = await this.startRelayAndMcp()
      try {
        const r = await this.deps.launcher.attach()
        notes.unshift(r.detail)
      } catch (e) {
        notes.unshift(m.attachFailed(errorText(e)))
      }
      this.deps.settings.set({ switchOn: true })
      return notes
    })
  }

  /** App start and post-update restart: relay and MCP only, never touches Figma. */
  restore(): Promise<BridgeState> {
    return this.run('restore', async () => {
      if (!this.deps.settings.get().switchOn) return []
      return this.startRelayAndMcp()
    })
  }

  /** Stops the relay; MCP entries stay so turning back on recovers immediately. */
  turnOff(): Promise<BridgeState> {
    return this.run('turnOff', async () => {
      await this.deps.relay.stop()
      this.deps.settings.set({ switchOn: false })
      return []
    })
  }

  attachPlugin(): Promise<BridgeState> {
    return this.run('attachPlugin', async () => [(await this.deps.launcher.attach()).detail])
  }

  /** Polled: re-reads the relay status and emits only on change. */
  async refresh(): Promise<BridgeState> {
    return this.update(false)
  }

  private async startRelayAndMcp(): Promise<string[]> {
    await this.deps.relay.start()
    const results = await this.deps.registry.ensure(this.deps.launch())
    const errors = results.flatMap((r) => (r.error ? [r.error] : []))
    return errors.length ? [m.mcpPartial(errors)] : []
  }

  private run(action: Action, body: () => Promise<string[]>): Promise<BridgeState> {
    const existing = this.inflight.get(action)
    if (existing) return existing
    const prev = this.tail
    const p = (async () => {
      await prev
      try {
        try {
          const notes = await body()
          this.message = notes.length ? notes.join('\n') : undefined
        } catch (e) {
          const fail = { turnOn: m.relayFailed, restore: m.relayFailed, turnOff: m.actionFailed, attachPlugin: m.attachFailed }[action]
          this.message = e instanceof PortInUseError ? m.portInUse(e.port) : fail(errorText(e))
        }
        this.harness = await this.deps.registry.list(this.deps.launch()).catch(() => this.harness)
      } finally {
        this.inflight.delete(action)
      }
      return this.update(true)
    })()
    this.tail = p.catch(() => undefined)
    this.inflight.set(action, p)
    this.state = { ...this.state, busy: true }
    this.deps.emit(this.state)
    return p
  }

  private async update(force: boolean): Promise<BridgeState> {
    const switchOn = this.deps.settings.get().switchOn
    const { relay } = this.deps
    // turnOn saves the switch only after attach() returns (up to ~45 s), so an in-flight turnOn counts as on.
    const on = switchOn || this.inflight.has('turnOn')
    const status: BridgeStatus = !on || !relay.running ? 'off' : relay.status().figmaJoined > 0 ? 'connected' : 'relay-only'
    const next: BridgeState = {
      switchOn,
      status,
      busy: this.inflight.size > 0,
      figmaInstalled: this.deps.env.figmaInstalled(),
      figmaRunning: await this.deps.env.figmaRunning().catch(() => false),
      harness: this.harness,
      ...(this.message ? { message: this.message } : {}),
    }
    const changed = JSON.stringify(next) !== JSON.stringify(this.state)
    this.state = next
    if (changed || force) this.deps.emit(next)
    return next
  }
}
