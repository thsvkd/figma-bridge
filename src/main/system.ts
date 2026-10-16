import { execFileSync, spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join, win32 } from 'node:path'
import type { HarnessId } from '@shared/types'
import { systemMessages } from './messages'
import type { Paths } from './paths'

// Real OS boundaries (processes, PATH lookup, downloads) shared by the GUI and the headless CLI modes.

export interface ProcessResult {
  code: number
  stdout: string
  stderr: string
}

const DEFAULT_TIMEOUT_MS = 30_000

export function runProcess(
  file: string,
  args: string[],
  opts: { cwd?: string; stdin?: string; timeoutMs?: number } = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: opts.cwd, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8').on('data', (d: string) => (stdout += d))
    child.stderr.setEncoding('utf8').on('data', (d: string) => (stderr += d))
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(systemMessages.timedOut(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)))
    }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    child.once('error', (e) => {
      clearTimeout(timer)
      reject(e)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? 1, stdout, stderr })
    })
    child.stdin.on('error', () => undefined) // the child may exit before reading its stdin
    child.stdin.end(opts.stdin ?? '')
  })
}

// .cmd/.ps1 npm shims cannot be spawned directly (EINVAL since CVE-2024-27980), so run the sibling .ps1.
export function runCli(file: string, args: string[], opts: { timeoutMs?: number } = {}): Promise<ProcessResult> {
  if (!/\.(cmd|ps1)$/i.test(file)) return runProcess(file, args, opts)
  const script = file.replace(/\.cmd$/i, '.ps1')
  return runProcess('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], opts)
}

function expandEnv(value: string, env: NodeJS.ProcessEnv): string {
  return value.replace(/%([^%]+)%/g, (whole, name: string) => env[name] ?? whole)
}

// A process keeps the PATH it started with, so a tool installed a moment ago is only visible in the registry.
function registryPath(env: NodeJS.ProcessEnv): string[] {
  const keys = ['HKCU\\Environment', 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment']
  return keys.flatMap((key) => {
    try {
      const out = execFileSync('reg.exe', ['query', key, '/v', 'Path'], { encoding: 'utf8', windowsHide: true })
      const value = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)$/im.exec(out)?.[1]?.trim()
      return value ? expandEnv(value, env).split(delimiter) : []
    } catch {
      return []
    }
  })
}

const EXTENSIONS = ['.exe', '.cmd', '.ps1']

function searchDirs(dirs: string[], name: string, exists: (p: string) => boolean): string | null {
  for (const dir of dirs) {
    for (const ext of EXTENSIONS) {
      const candidate = win32.join(dir, name + ext)
      if (exists(candidate)) return candidate
    }
  }
  return null
}

export function createFindCommand(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = existsSync) {
  const profile = env.USERPROFILE ?? ''
  const local = env.LOCALAPPDATA ?? ''
  const winget = win32.join(local, 'Microsoft', 'WinGet', 'Links')
  // Native installers, winget and npm put the tools here even when the PATH this process got is stale.
  const known: Record<'claude' | 'codex', string[]> = {
    claude: [win32.join(profile, '.local', 'bin', 'claude.exe'), win32.join(winget, 'claude.exe')],
    codex: [
      win32.join(env.APPDATA ?? '', 'npm', 'codex.cmd'),
      win32.join(local, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
      win32.join(profile, '.codex', 'packages', 'standalone', 'current', 'bin', 'codex.exe'),
      win32.join(winget, 'codex.exe'),
    ],
  }
  return (name: 'claude' | 'codex'): string | null =>
    searchDirs((env.PATH ?? env.Path ?? '').split(delimiter).filter(Boolean), name, exists) ??
    known[name].find(exists) ??
    searchDirs(registryPath(env).filter(Boolean), name, exists)
}

export function createHarnessFinder(paths: Paths, findCommand: (name: 'claude' | 'codex') => string | null) {
  return (id: HarnessId): string | null =>
    id === 'claude-desktop'
      ? existsSync(win32.dirname(paths.claudeDesktopConfig))
        ? win32.dirname(paths.claudeDesktopConfig)
        : null
      : findCommand(id)
}

export async function download(url: string): Promise<{ file: string; cleanup: () => Promise<void> }> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Download failed: HTTP ${response.status}`)
  const dir = mkdtempSync(join(tmpdir(), 'figma-bridge-'))
  const file = join(dir, new URL(url).pathname.split('/').pop() || 'download')
  writeFileSync(file, Buffer.from(await response.arrayBuffer()))
  return { file, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

// Opens a console window the user can type into (a login needs a human). `start` gives the child its own
// console; ponytail: a literal % in the tool path would be expanded by cmd.exe, which real install paths avoid.
export function spawnVisible(file: string, args: string[]): void {
  const quote = (a: string) => (/[\s&|<>()^]/.test(a) ? `"${a}"` : a)
  const line = `start "" ${[file, ...args].map(quote).join(' ')}`
  const child = spawn('cmd.exe', ['/d', '/s', '/c', `"${line}"`], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    windowsVerbatimArguments: true,
  })
  child.unref()
}
