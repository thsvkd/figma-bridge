import { describe, expect, it } from 'vitest'
import { createPaths } from './paths'

const env = { LOCALAPPDATA: 'C:\\L', APPDATA: 'C:\\A', USERPROFILE: 'C:\\U' }

describe('createPaths', () => {
  it('puts runtime data under LOCALAPPDATA\\FigmaBridge by default', () => {
    const p = createPaths(env)
    expect(p.home).toBe('C:\\L\\FigmaBridge')
    expect(p.logDir).toBe('C:\\L\\FigmaBridge\\logs')
    expect(p.settingsFile).toBe('C:\\L\\FigmaBridge\\settings.json')
  })

  it('honors FIGMA_BRIDGE_HOME', () => {
    const p = createPaths({ ...env, FIGMA_BRIDGE_HOME: 'D:\\Data\\FB' })
    expect(p.home).toBe('D:\\Data\\FB')
    expect(p.settingsFile).toBe('D:\\Data\\FB\\settings.json')
  })

  it('locates the AI tool config files', () => {
    const p = createPaths(env)
    expect(p.claudeJson).toBe('C:\\U\\.claude.json')
    expect(p.claudeDesktopConfig).toBe('C:\\A\\Claude\\claude_desktop_config.json')
    expect(p.codexConfig).toBe('C:\\U\\.codex\\config.toml')
  })

  it('lists Figma executable candidates', () => {
    const p = createPaths({ ...env, ProgramFiles: 'C:\\PF' })
    expect(p.figmaCandidates).toEqual([
      'C:\\L\\Figma\\Figma.exe',
      'C:\\L\\Programs\\Figma\\Figma.exe',
      'C:\\PF\\Figma\\Figma.exe',
    ])
  })

  it('keeps Korean and spaced user paths intact', () => {
    const p = createPaths({
      LOCALAPPDATA: 'C:\\Users\\홍 길동\\AppData\\Local',
      APPDATA: 'C:\\Users\\홍 길동\\AppData\\Roaming',
      USERPROFILE: 'C:\\Users\\홍 길동',
    })
    expect(p.home).toBe('C:\\Users\\홍 길동\\AppData\\Local\\FigmaBridge')
    expect(p.claudeJson).toBe('C:\\Users\\홍 길동\\.claude.json')
  })

  it('treats a blank FIGMA_BRIDGE_HOME as unset', () => {
    expect(createPaths({ ...env, FIGMA_BRIDGE_HOME: '  ' }).home).toBe('C:\\L\\FigmaBridge')
  })
})
