import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFindCommand, runProcess } from './system'

const env = {
  USERPROFILE: 'C:\\Users\\u',
  LOCALAPPDATA: 'C:\\Users\\u\\AppData\\Local',
  APPDATA: 'C:\\Users\\u\\AppData\\Roaming',
}

function findWith(present: string[], extraEnv: NodeJS.ProcessEnv = {}) {
  return createFindCommand({ ...env, ...extraEnv }, (p) => present.includes(p))
}

describe('createFindCommand', () => {
  it.each([
    ['claude', 'C:\\Users\\u\\.local\\bin\\claude.exe'],
    ['claude', 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\claude.exe'],
    ['codex', 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'],
    ['codex', 'C:\\Users\\u\\AppData\\Local\\Programs\\OpenAI\\Codex\\bin\\codex.exe'],
    ['codex', 'C:\\Users\\u\\.codex\\packages\\standalone\\current\\bin\\codex.exe'],
    ['codex', 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WinGet\\Links\\codex.exe'],
  ] as const)('finds %s at %s when PATH has nothing', (name, file) => {
    expect(findWith([file])(name)).toBe(file)
  })

  it('prefers PATH over the known install locations', () => {
    const find = findWith(['D:\\tools\\codex.exe', 'C:\\Users\\u\\AppData\\Roaming\\npm\\codex.cmd'], {
      PATH: 'D:\\empty;D:\\tools',
    })
    expect(find('codex')).toBe('D:\\tools\\codex.exe')
  })

  it('does not return another tool from the known locations', () => {
    expect(findWith(['C:\\Users\\u\\.local\\bin\\claude.exe'])('codex')).not.toBe(
      'C:\\Users\\u\\.local\\bin\\claude.exe',
    )
  })
})

describe('runProcess timeout', () => {
  it('rejects in Korean and kills a child that outlives the timeout', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fb-timeout-'))
    try {
      const pidFile = join(dir, 'pid')
      const script = "require('fs').writeFileSync(process.argv[1], String(process.pid)); setTimeout(() => {}, 60000)"
      await expect(runProcess(process.execPath, ['-e', script, pidFile], { timeoutMs: 1000 })).rejects.toThrow(/중단/)
      const pid = Number(readFileSync(pidFile, 'utf8'))
      expect(pid).toBeGreaterThan(0)
      await new Promise((r) => setTimeout(r, 200))
      expect(() => process.kill(pid, 0)).toThrow()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
