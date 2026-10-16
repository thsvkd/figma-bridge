import { describe, expect, it } from 'vitest'
import { maskSecrets, runAiDoctor, type AiDoctorDeps } from './aiDoctor'
import type { DoctorResult } from './Doctor'

const before: DoctorResult = {
  checks: [{ id: 'relay', label: '중계 서버', status: 'fail', text: '꺼져 있음' }],
  applied: [],
  ok: false,
}

function setup(
  tools: { claude?: string; codex?: string },
  output = { code: 0, stdout: 'done', stderr: '' },
) {
  const files = new Map<string, string>()
  const runs: Array<{ file: string; args: string[]; cwd: string; stdin: string }> = []
  const deps: AiDoctorDeps = {
    findCommand: (n) => tools[n] ?? null,
    runProcess: async (file, args, o) => {
      runs.push({ file, args, cwd: o.cwd, stdin: o.stdin })
      return output
    },
    writeFile: async (f, t) => void files.set(f, t),
    readTemplate: async () => 'bundle={{BUNDLE}} exe={{EXE}} home={{HOME}} plugin={{PLUGIN}}',
    doctor: async () => ({ ...before, ok: true }),
    exePath: 'C:\\Users\\홍 길동\\figma-bridge.exe',
    home: 'C:\\L\\FigmaBridge',
    logDir: 'C:\\L\\FigmaBridge\\logs',
    pluginUrl: 'https://example.test/plugin',
    now: () => new Date('2026-10-16T01:02:03Z'),
  }
  return { deps, files, runs }
}

describe('maskSecrets', () => {
  it('masks bearer tokens, JSON secret fields and sk- keys', () => {
    const t = maskSecrets('Bearer abc.DEF-123= {"api_key": "hunter2", "Token":"x"} sk-abcdefghij1234')
    expect(t).not.toContain('abc.DEF')
    expect(t).not.toContain('hunter2')
    expect(t).not.toContain('abcdefghij1234')
    expect(t).toContain('Bearer ***')
    expect(t).toContain('"api_key": "***"')
    expect(t).toContain('sk-***')
  })
  it('leaves empty text alone', () => {
    expect(maskSecrets('')).toBe('')
  })
})

describe('runAiDoctor', () => {
  it('prefers claude, passes the filled prompt, writes the bundle and returns masked output', async () => {
    const s = setup(
      { claude: 'C:\\bin\\claude.exe', codex: 'C:\\bin\\codex.exe' },
      { code: 0, stdout: 'ok Bearer secret123', stderr: '' },
    )
    const r = await runAiDoctor(before, s.deps)
    expect(r.harness).toBe('Claude Code')
    expect(s.runs).toHaveLength(1)
    expect(s.runs[0].file).toBe('C:\\bin\\claude.exe')
    expect(s.runs[0].args[0]).toBe('-p')
    expect(s.runs[0].args).toEqual(expect.arrayContaining(['--allowedTools', 'Bash']))
    const prompt = s.runs[0].stdin
    expect(s.runs[0].args.join(' ')).not.toContain('bundle=')
    expect(prompt).toContain(r.bundlePath)
    expect(prompt).toContain('C:\\Users\\홍 길동\\figma-bridge.exe')
    expect(prompt).not.toContain('{{')
    expect(JSON.parse(s.files.get(r.bundlePath)!).leftoverFail).toEqual(['relay'])
    expect(r.output).toContain('Bearer ***')
    expect(r.output).not.toContain('secret123')
    expect(r.after.ok).toBe(true)
  })

  it('falls back to codex exec when claude is absent', async () => {
    const s = setup({ codex: 'C:\\bin\\codex.exe' })
    const r = await runAiDoctor(before, s.deps)
    expect(r.harness).toBe('Codex')
    expect(s.runs[0].args).toEqual(['exec', '--skip-git-repo-check', '-'])
    expect(s.runs[0].stdin).toContain('bundle=')
  })

  it('runs a codex .ps1 shim through powershell -File', async () => {
    const s = setup({ codex: 'C:\\bin\\codex.ps1' })
    await runAiDoctor(before, s.deps)
    expect(s.runs[0].file).toBe('powershell.exe')
    expect(s.runs[0].args.slice(0, 5)).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      'C:\\bin\\codex.ps1',
    ])
  })

  it('runs a codex .cmd shim through its sibling .ps1 and never puts the prompt on argv', async () => {
    const cmd = 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd'
    const s = setup({ codex: cmd })
    await runAiDoctor(before, s.deps)
    const run = s.runs[0]
    expect(run.file).toBe('powershell.exe')
    expect(run.args).toEqual([
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      cmd.replace('.cmd', '.ps1'),
      'exec',
      '--skip-git-repo-check',
      '-',
    ])
    expect(run.stdin).toContain('bundle=')
  })

  it('throws a Korean message and runs nothing when no tool exists', async () => {
    const s = setup({})
    await expect(runAiDoctor(before, s.deps)).rejects.toThrow(/AI 점검/)
    expect(s.runs).toHaveLength(0)
  })

  it('uses the fallback prompt when the template is missing', async () => {
    const s = setup({ claude: 'C:\\bin\\claude.exe' })
    s.deps.readTemplate = async () => {
      throw new Error('ENOENT')
    }
    await runAiDoctor(before, s.deps)
    expect(s.runs[0].stdin.length).toBeGreaterThan(0)
  })
})
