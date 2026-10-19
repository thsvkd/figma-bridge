import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const read = (path: string) => readFileSync(path, 'utf8')

const LEGACY_PATHS = ['App.cmd', 'App.ps1', 'App.vbs', 'Install.ps1', 'Setup.cmd', 'Uninstall.cmd', '설치.cmd', 'lib', 'prompts', 'tests']

describe('legacy PowerShell implementation', () => {
  it.each(LEGACY_PATHS)('%s is removed from the repository', (path) => {
    expect(existsSync(path)).toBe(false)
  })

  it('keeps the design spec and the implementation plan', () => {
    expect(existsSync('docs/superpowers/specs/2026-10-16-electron-installer-ota-design.md')).toBe(true)
    expect(existsSync('docs/superpowers/plans/2026-10-16-electron-installer-ota.md')).toBe(true)
  })
})

describe('README.md', () => {
  const readme = read('README.md')

  it('tells users to install from the Release setup.exe and how to pass the SmartScreen warning', () => {
    expect(readme).toContain('setup.exe')
    expect(readme).toContain('추가 정보')
    expect(readme).toContain('실행')
  })

  it('describes the switch and the three states', () => {
    for (const state of ['꺼짐', '플러그인 미연결', '연결됨']) expect(readme).toContain(state)
  })

  it('describes the update flow with a user-started download and install', () => {
    expect(readme).toContain('다운로드')
    expect(readme).toContain('재시작 후 설치')
  })

  it('tells the user that Claude Desktop needs a restart to pick up the entry', () => {
    expect(readme).toMatch(/Claude Desktop.*재시작/)
  })

  it('no longer tells users to run the removed scripts or mentions Bun', () => {
    expect(readme).not.toMatch(/Setup\.cmd|App\.ps1|Install\.ps1/)
    expect(readme).not.toContain('Bun')
  })
})

describe('docs/manual-checklist.md', () => {
  const checklist = read('docs/manual-checklist.md')

  it('keeps the 화면 section from task 9 and adds the later sections', () => {
    for (const heading of [
      '## 화면',
      '## 피그마 조작 (Win32 스모크)',
      '## 플러그인 설치 여부별 연동',
      '## 복원과 자동 시작',
      '## 업데이트',
      '## 제거와 이전 버전',
    ]) {
      expect(checklist).toContain(heading)
    }
  })

  it('says a leftover legacy relay is stopped automatically only when /status and socket.pid identify it', () => {
    const lines = checklist.split('\n')
    expect(lines.some((line) => line.includes('/status') && line.includes('socket.pid') && line.includes('자동'))).toBe(true)
  })

  it('has no placeholder markers', () => {
    expect(checklist).not.toMatch(/TODO|test\.skip|\.only\(/)
  })
})
