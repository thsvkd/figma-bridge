import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'

let dir: string
let file: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'fb-settings-'))
  file = join(dir, 'nested', 'settings.json')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('SettingsStore', () => {
  it('returns defaults when the file does not exist', () => {
    expect(new SettingsStore(file).get()).toEqual({ switchOn: false, launchAtLogin: false })
  })

  it('persists set() across new instances', () => {
    const store = new SettingsStore(file)
    expect(store.set({ switchOn: true })).toEqual({ switchOn: true, launchAtLogin: false })
    expect(new SettingsStore(file).get()).toEqual({ switchOn: true, launchAtLogin: false })
    new SettingsStore(file).set({ launchAtLogin: true })
    expect(new SettingsStore(file).get()).toEqual({ switchOn: true, launchAtLogin: true })
  })

  it('ignores unknown fields and defaults missing ones', () => {
    const store = new SettingsStore(file)
    store.set({ switchOn: true })
    writeFileSync(file, JSON.stringify({ switchOn: true, extra: 1, launchAtLogin: 'yes' }))
    expect(new SettingsStore(file).get()).toEqual({ switchOn: true, launchAtLogin: false })
    store.set({ launchAtLogin: true })
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ switchOn: true, launchAtLogin: true })
  })

  it('returns defaults for broken JSON without overwriting the file on read', () => {
    new SettingsStore(file).set({ switchOn: true })
    writeFileSync(file, '{ not json')
    const store = new SettingsStore(file)
    expect(store.get()).toEqual({ switchOn: false, launchAtLogin: false })
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })

  it('treats non-object JSON as defaults', () => {
    new SettingsStore(file).set({ switchOn: true })
    writeFileSync(file, '[1,2]')
    expect(new SettingsStore(file).get()).toEqual({ switchOn: false, launchAtLogin: false })
  })

  it('reads a file with a UTF-8 BOM', () => {
    new SettingsStore(file).set({ switchOn: true })
    writeFileSync(file, '\uFEFF{"switchOn":true,"launchAtLogin":true}')
    expect(new SettingsStore(file).get()).toEqual({ switchOn: true, launchAtLogin: true })
  })

  it('writes atomically without leaving temp files behind', () => {
    const store = new SettingsStore(file)
    store.set({ switchOn: true })
    store.set({ switchOn: false })
    expect(existsSync(file)).toBe(true)
    expect(readdirSync(join(dir, 'nested'))).toEqual(['settings.json'])
  })
})
