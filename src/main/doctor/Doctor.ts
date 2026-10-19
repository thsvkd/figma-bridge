import type { HarnessState } from '@shared/types'
import { doctorMessages as m } from '../messages'
import type { FigmaDriver } from '../figma/FigmaDriver'
import type { RelayStatus } from '../relay/Relay'

export type FixId = 'start-relay' | 'start-figma' | 'attach-plugin' | 'connect-harness' | 'install-harness'

export interface Check {
  id: string
  label: string
  status: 'ok' | 'warn' | 'fail'
  text: string
  hint?: string
  fixId?: FixId
}

export interface DoctorResult {
  checks: Check[]
  applied: string[]
  ok: boolean
}

export interface DoctorDeps {
  /** null when the relay is not running. */
  relayStatus: () => RelayStatus | null
  startRelay: () => Promise<void>
  figma: Pick<FigmaDriver, 'isInstalled' | 'isRunning' | 'launch'>
  listHarness: () => Promise<HarnessState[]>
  /** Writes the MCP entry into every installed AI tool. */
  connectHarness: () => Promise<void>
  attachPlugin: () => Promise<{ message?: string }>
  /** Installs the recommended AI tool (Claude Code) and returns a human readable result. */
  installHarness: () => Promise<string>
}

export class Doctor {
  constructor(private readonly deps: DoctorDeps) {}

  /**
   * `figmaInput: false` (used by the headless --doctor-fix path) never launches Figma or attaches the
   * plugin, because attaching sends key input and must only happen when the user presses a button.
   */
  async run(opts: { fix?: boolean; figmaInput?: boolean } = {}): Promise<DoctorResult> {
    const applied: string[] = []
    if (opts.fix) {
      const done = new Set<FixId>()
      for (const c of await this.checks()) {
        if (c.status === 'ok' || !c.fixId || done.has(c.fixId)) continue
        if (opts.figmaInput === false && (c.fixId === 'start-figma' || c.fixId === 'attach-plugin')) continue
        done.add(c.fixId)
        try {
          applied.push(await this.applyFix(c.fixId))
        } catch (e) {
          applied.push(m.fixFailed(c.fixId, e instanceof Error ? e.message : String(e)))
        }
      }
    }
    const checks = await this.checks()
    return { checks, applied, ok: checks.every((c) => c.status !== 'fail') }
  }

  private async applyFix(id: FixId): Promise<string> {
    const d = this.deps
    switch (id) {
      case 'start-relay':
        await d.startRelay()
        return m.fixRelay
      case 'start-figma':
        await d.figma.launch()
        return m.fixFigma
      case 'attach-plugin':
        return (await d.attachPlugin()).message ?? m.fixPlugin
      case 'connect-harness':
        await d.connectHarness()
        return m.fixHarness
      case 'install-harness': {
        const detail = await d.installHarness()
        await d.connectHarness()
        return detail
      }
    }
  }

  private async checks(): Promise<Check[]> {
    const d = this.deps
    const checks: Check[] = []

    const relay = d.relayStatus()
    checks.push(
      relay
        ? { id: 'relay', label: m.relayLabel, status: 'ok', text: m.relayOk(relay.port) }
        : { id: 'relay', label: m.relayLabel, status: 'fail', text: m.relayDown, hint: m.relayHint, fixId: 'start-relay' },
    )

    if (!d.figma.isInstalled()) {
      checks.push({ id: 'figma', label: m.figmaLabel, status: 'fail', text: m.figmaMissing, hint: m.figmaMissingHint })
    } else if (await d.figma.isRunning()) {
      checks.push({ id: 'figma', label: m.figmaLabel, status: 'ok', text: m.figmaOk })
    } else {
      checks.push({
        id: 'figma',
        label: m.figmaLabel,
        status: 'warn',
        text: m.figmaStopped,
        hint: m.figmaStoppedHint,
        fixId: 'start-figma',
      })
    }

    checks.push(
      (relay?.figmaJoined ?? 0) > 0
        ? { id: 'plugin', label: m.pluginLabel, status: 'ok', text: m.pluginOk }
        : {
            id: 'plugin',
            label: m.pluginLabel,
            status: 'warn',
            text: m.pluginMissing,
            hint: m.pluginHint,
            fixId: 'attach-plugin',
          },
    )

    const harness = await d.listHarness()
    for (const h of harness) {
      if (h.installed) {
        checks.push(
          h.registered
            ? { id: h.id, label: h.name, status: 'ok', text: m.harnessOk }
            : { id: h.id, label: h.name, status: 'fail', text: m.harnessUnregistered, fixId: 'connect-harness' },
        )
      } else if (h.id !== 'claude-desktop') {
        // Claude Desktop is only worth mentioning when it exists, like the legacy doctor.
        checks.push({ id: h.id, label: h.name, status: 'warn', text: m.harnessMissing })
      }
    }
    if (!harness.some((h) => h.installed)) {
      checks.push({
        id: 'harness-any',
        label: m.anyLabel,
        status: 'fail',
        text: m.anyMissing,
        hint: m.anyHint,
        fixId: 'install-harness',
      })
    }
    return checks
  }
}
