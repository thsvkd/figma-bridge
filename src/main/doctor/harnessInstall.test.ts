import { describe, expect, it } from 'vitest'
import { getHarnessCatalog, installHarness, startHarnessLogin, type InstallDeps } from './harnessInstall'

interface Run {
  file: string
  args: string[]
}

function setup(o: {
  installedAfter?: Array<'winget' | 'script'>
  wingetCodes?: number[]
  wingetThrows?: boolean
  scriptCode?: number
  downloadFails?: boolean
  alreadyAt?: string
}) {
  const runs: Run[] = []
  const removed: string[] = []
  const state = { installed: o.alreadyAt ?? null, wingetCalls: 0 }
  const deps: InstallDeps = {
    findCommand: () => state.installed,
    runProcess: async (file, args) => {
      runs.push({ file, args })
      if (file === 'winget.exe') {
        if (o.wingetThrows) throw new Error('spawn winget.exe ENOENT')
        const code = (o.wingetCodes ?? [0])[state.wingetCalls++] ?? 1
        if (code === 0 && o.installedAfter?.includes('winget')) state.installed = 'C:\\bin\\tool.exe'
        return { code }
      }
      const code = o.scriptCode ?? 0
      if (code === 0 && o.installedAfter?.includes('script')) state.installed = 'C:\\bin\\tool.exe'
      return { code }
    },
    download: async () => {
      if (o.downloadFails) throw new Error('offline')
      return { file: 'C:\\tmp\\install.ps1', cleanup: async () => void removed.push('C:\\tmp\\install.ps1') }
    },
  }
  return { deps, runs, removed }
}

describe('getHarnessCatalog', () => {
  it('lists Claude Code, Codex and Claude Desktop with winget ids and URLs', () => {
    const c = getHarnessCatalog()
    expect(c.map((e) => e.id)).toEqual(['claude', 'codex', 'claude-desktop'])
    expect(c.map((e) => e.wingetId)).toEqual(['Anthropic.ClaudeCode', 'OpenAI.Codex', 'Anthropic.Claude'])
    expect(c[0].scriptUrl).toBe('https://claude.ai/install.ps1')
    expect(c[1].scriptUrl).toBe('https://chatgpt.com/codex/install.ps1')
    expect(c[2].scriptUrl).toBe('')
    expect(c.every((e) => e.manualUrl.startsWith('https://'))).toBe(true)
  })
})

describe('installHarness', () => {
  it('already installed: no process is run', async () => {
    const { deps, runs } = setup({ alreadyAt: 'C:\\x\\claude.exe' })
    const r = await installHarness('claude', deps)
    expect(r).toMatchObject({ ok: true, method: 'already', needsLogin: false })
    expect(runs).toHaveLength(0)
  })

  it('winget success with the command found afterwards', async () => {
    const { deps, runs } = setup({ installedAfter: ['winget'] })
    const r = await installHarness('claude', deps)
    expect(r).toMatchObject({ ok: true, method: 'winget', needsLogin: true })
    expect(runs).toHaveLength(1)
    expect(runs[0].args).toEqual(
      expect.arrayContaining(['install', '-e', '--id', 'Anthropic.ClaudeCode', '--scope', 'user']),
    )
  })

  it('retries winget without --scope user when the first attempt fails', async () => {
    const { deps, runs } = setup({ installedAfter: ['winget'], wingetCodes: [1, 0] })
    const r = await installHarness('codex', deps)
    expect(r.method).toBe('winget')
    expect(runs).toHaveLength(2)
    expect(runs[0].args).toContain('--scope')
    expect(runs[1].args).not.toContain('--scope')
  })

  it('winget failure falls back to the script run from a downloaded file', async () => {
    const { deps, runs, removed } = setup({ wingetCodes: [1, 1], installedAfter: ['script'] })
    const r = await installHarness('claude', deps)
    expect(r).toMatchObject({ ok: true, method: 'script', needsLogin: true })
    const script = runs[runs.length - 1]
    expect(script.file).toBe('powershell.exe')
    expect(script.args).toEqual(['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'C:\\tmp\\install.ps1'])
    expect(removed).toEqual(['C:\\tmp\\install.ps1'])
  })

  it('winget missing (spawn throws) also falls back to the script', async () => {
    const { deps } = setup({ wingetThrows: true, installedAfter: ['script'] })
    expect((await installHarness('claude', deps)).method).toBe('script')
  })

  it('winget exit 0 but command still missing continues to the script', async () => {
    const { deps } = setup({ wingetCodes: [0], installedAfter: ['script'] })
    expect((await installHarness('claude', deps)).method).toBe('script')
  })

  it('both fail: Korean guidance with the manual URL, no throw', async () => {
    const { deps } = setup({ wingetCodes: [1, 1], scriptCode: 1 })
    const r = await installHarness('claude', deps)
    expect(r).toMatchObject({ ok: false, method: 'none', needsLogin: false })
    expect(r.manualUrl).toBe('https://docs.claude.com/en/docs/claude-code/setup')
    expect(r.detail).toContain(r.manualUrl)
    expect(r.detail).toMatch(/[가-힣]/)
  })

  it('download failure is treated as a script failure', async () => {
    const { deps } = setup({ wingetCodes: [1, 1], downloadFails: true })
    const r = await installHarness('claude', deps)
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('https://docs.claude.com')
  })

  it('Claude Desktop has no script: only winget is tried', async () => {
    const { deps, runs } = setup({ wingetCodes: [1, 1] })
    const r = await installHarness('claude-desktop', deps)
    expect(r.ok).toBe(false)
    expect(runs.every((x) => x.file === 'winget.exe')).toBe(true)
    expect(r.manualUrl).toBe('https://claude.ai/download')
  })
})

describe('startHarnessLogin', () => {
  function loginDeps(found: string | null) {
    const spawned: Run[] = []
    const opened: string[] = []
    return {
      spawned,
      opened,
      deps: {
        findCommand: () => found,
        spawnVisible: (file: string, args: string[]) => void spawned.push({ file, args }),
        openUrl: async (u: string) => void opened.push(u),
      },
    }
  }

  it('not installed returns a Korean notice and starts nothing', async () => {
    const l = loginDeps(null)
    const msg = await startHarnessLogin('claude', l.deps)
    expect(msg).toMatch(/설치되지 않았/)
    expect(l.spawned).toHaveLength(0)
  })

  it('codex opens a visible PowerShell with `login`, path quoted for spaces', async () => {
    const l = loginDeps('C:\\Users\\홍 길동\\codex.exe')
    await startHarnessLogin('codex', l.deps)
    expect(l.spawned[0].file).toBe('powershell.exe')
    expect(l.spawned[0].args.slice(0, 3)).toEqual(['-NoExit', '-NoProfile', '-Command'])
    expect(l.spawned[0].args[3]).toBe("& 'C:\\Users\\홍 길동\\codex.exe' login")
  })

  it('claude runs without extra args; a single quote in the path is escaped', async () => {
    const l = loginDeps("C:\\o'brien\\claude.exe")
    await startHarnessLogin('claude', l.deps)
    expect(l.spawned[0].args[3]).toBe("& 'C:\\o''brien\\claude.exe'")
  })

  it('Claude Desktop opens the download page instead of a shell', async () => {
    const l = loginDeps('C:\\Claude')
    const msg = await startHarnessLogin('claude-desktop', l.deps)
    expect(l.spawned).toHaveLength(0)
    expect(l.opened).toEqual(['https://claude.ai/download'])
    expect(msg).toMatch(/로그인/)
  })
})
