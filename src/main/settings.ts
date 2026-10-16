import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface Settings {
  switchOn: boolean
  launchAtLogin: boolean
}

const DEFAULTS: Settings = { switchOn: false, launchAtLogin: false }

function parse(raw: string): Settings {
  try {
    const data: unknown = JSON.parse(raw.replace(/^\uFEFF/, ''))
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...DEFAULTS }
    const o = data as Record<string, unknown>
    return {
      switchOn: typeof o.switchOn === 'boolean' ? o.switchOn : DEFAULTS.switchOn,
      launchAtLogin: typeof o.launchAtLogin === 'boolean' ? o.launchAtLogin : DEFAULTS.launchAtLogin,
    }
  } catch {
    return { ...DEFAULTS }
  }
}

export class SettingsStore {
  constructor(private readonly file: string) {}

  // Reading never writes: a broken file stays untouched until the next set().
  get(): Settings {
    try {
      return parse(readFileSync(this.file, 'utf8'))
    } catch {
      return { ...DEFAULTS }
    }
  }

  set(patch: Partial<Settings>): Settings {
    const next = { ...this.get(), ...patch }
    mkdirSync(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    writeFileSync(tmp, JSON.stringify(next, null, 2))
    renameSync(tmp, this.file)
    return next
  }
}
