import type { HarnessId } from '@shared/types'
import { harnessInstallMessages as m } from '../messages'

// Behavioral port of lib/HarnessInstall.ps1: winget first (no admin needed), then the official script.
// The script is downloaded to a file and run with -NoProfile -ExecutionPolicy Bypass -File so that
// profiles and execution policy cannot break it and failures point at a real line.

export interface HarnessCatalogEntry {
  id: HarnessId
  name: string
  recommended: boolean
  wingetId: string
  scriptUrl: string
  manualUrl: string
  loginArgs: string[]
  loginNote: string
}

const CATALOG: HarnessCatalogEntry[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    recommended: true,
    wingetId: 'Anthropic.ClaudeCode',
    scriptUrl: 'https://claude.ai/install.ps1',
    manualUrl: 'https://docs.claude.com/en/docs/claude-code/setup',
    loginArgs: [],
    loginNote: m.claudeLoginNote,
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    recommended: false,
    wingetId: 'OpenAI.Codex',
    scriptUrl: 'https://chatgpt.com/codex/install.ps1',
    manualUrl: 'https://developers.openai.com/codex/cli',
    loginArgs: ['login'],
    loginNote: m.codexLoginNote,
  },
  {
    id: 'claude-desktop',
    name: 'Claude Desktop',
    recommended: false,
    wingetId: 'Anthropic.Claude',
    scriptUrl: '',
    manualUrl: 'https://claude.ai/download',
    loginArgs: [],
    loginNote: m.desktopLoginNote,
  },
]

export function getHarnessCatalog(): HarnessCatalogEntry[] {
  return CATALOG.map((e) => ({ ...e, loginArgs: [...e.loginArgs] }))
}

export interface InstallDeps {
  /** Path (or install dir for Claude Desktop) of the tool, null when absent. Must see fresh PATH after installs. */
  findCommand: (id: HarnessId) => string | null
  runProcess: (file: string, args: string[]) => Promise<{ code: number }>
  /** Downloads the URL to a temp file. */
  download: (url: string) => Promise<{ file: string; cleanup: () => Promise<void> }>
}

export interface InstallResult {
  ok: boolean
  method: 'already' | 'winget' | 'script' | 'none'
  needsLogin: boolean
  detail: string
  manualUrl: string
}

function entryOf(id: HarnessId): HarnessCatalogEntry {
  const e = CATALOG.find((x) => x.id === id)
  if (!e) throw new Error(`Unknown harness: ${id}`)
  return e
}

async function viaWinget(e: HarnessCatalogEntry, deps: InstallDeps): Promise<boolean> {
  const common = ['--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity']
  const base = ['install', '-e', '--id', e.wingetId, ...common]
  try {
    if ((await deps.runProcess('winget.exe', [...base, '--scope', 'user'])).code === 0) return true
    // Some packages reject --scope user, so retry once without it.
    return (await deps.runProcess('winget.exe', base)).code === 0
  } catch {
    return false // winget is not installed
  }
}

async function viaScript(e: HarnessCatalogEntry, deps: InstallDeps): Promise<boolean> {
  let downloaded: Awaited<ReturnType<InstallDeps['download']>>
  try {
    downloaded = await deps.download(e.scriptUrl)
  } catch {
    return false
  }
  try {
    const r = await deps.runProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      downloaded.file,
    ])
    return r.code === 0
  } catch {
    return false
  } finally {
    await downloaded.cleanup().catch(() => undefined)
  }
}

export async function installHarness(id: HarnessId, deps: InstallDeps): Promise<InstallResult> {
  const e = entryOf(id)
  const done = (method: 'already' | 'winget' | 'script', detail: string): InstallResult => ({
    ok: true,
    method,
    needsLogin: method !== 'already',
    detail,
    manualUrl: e.manualUrl,
  })

  if (deps.findCommand(id)) return done('already', m.already(e.name))

  const tried = ['winget']
  if ((await viaWinget(e, deps)) && deps.findCommand(id)) return done('winget', m.viaWinget(e.name, e.loginNote))

  if (e.scriptUrl) {
    tried.push(m.scriptLabel)
    if ((await viaScript(e, deps)) && deps.findCommand(id)) return done('script', m.viaScript(e.name, e.loginNote))
  }

  return {
    ok: false,
    method: 'none',
    needsLogin: false,
    detail: m.failed(e.name, tried, e.manualUrl),
    manualUrl: e.manualUrl,
  }
}

export interface LoginDeps {
  findCommand: (id: HarnessId) => string | null
  /** Starts a visible console window (the login needs a human). */
  spawnVisible: (file: string, args: string[]) => void
  openUrl: (url: string) => Promise<void>
}

export async function startHarnessLogin(id: HarnessId, deps: LoginDeps): Promise<string> {
  const e = entryOf(id)
  const path = deps.findCommand(id)
  if (!path) return m.notInstalled(e.name)
  if (id === 'claude-desktop') {
    await deps.openUrl(e.manualUrl)
    return m.desktopLogin
  }
  // Single-quoted PowerShell literal: spaces and non-ASCII are safe, a quote is doubled.
  const quoted = `'${path.replace(/'/g, "''")}'`
  const cmd = ['&', quoted, ...e.loginArgs].join(' ')
  deps.spawnVisible('powershell.exe', ['-NoExit', '-NoProfile', '-Command', cmd])
  return m.loginOpened(e.loginNote)
}
