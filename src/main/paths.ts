import { win32 } from 'node:path'

export interface Paths {
  home: string
  logDir: string
  settingsFile: string
  claudeJson: string
  claudeDesktopConfig: string
  codexConfig: string
  figmaCandidates: string[]
}

// Windows-only app: always use win32 path rules so results are identical in tests on any OS.
export function createPaths(env: NodeJS.ProcessEnv = process.env): Paths {
  const local = env.LOCALAPPDATA ?? ''
  const roaming = env.APPDATA ?? ''
  const profile = env.USERPROFILE ?? ''
  const programFiles = env.ProgramFiles ?? 'C:\\Program Files'
  const home = env.FIGMA_BRIDGE_HOME?.trim() ? env.FIGMA_BRIDGE_HOME : win32.join(local, 'FigmaBridge')

  return {
    home,
    logDir: win32.join(home, 'logs'),
    settingsFile: win32.join(home, 'settings.json'),
    claudeJson: win32.join(profile, '.claude.json'),
    claudeDesktopConfig: win32.join(roaming, 'Claude', 'claude_desktop_config.json'),
    codexConfig: win32.join(profile, '.codex', 'config.toml'),
    figmaCandidates: [
      win32.join(local, 'Figma', 'Figma.exe'),
      win32.join(local, 'Programs', 'Figma', 'Figma.exe'),
      win32.join(programFiles, 'Figma', 'Figma.exe'),
    ],
  }
}
