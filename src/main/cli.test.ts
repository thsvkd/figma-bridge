import { describe, expect, it } from 'vitest'
import { parseCliArgs } from './cli'

describe('parseCliArgs', () => {
  it('defaults to gui mode with a visible window', () => {
    expect(parseCliArgs([])).toEqual({ mode: 'gui', hidden: false })
  })

  it.each([
    ['--cleanup', 'cleanup'],
    ['--status', 'status'],
    ['--doctor-fix', 'doctor-fix'],
  ] as const)('maps %s to %s', (flag, mode) => {
    expect(parseCliArgs([flag])).toEqual({ mode, hidden: false })
  })

  it('reads --hidden together with gui mode', () => {
    expect(parseCliArgs(['--hidden'])).toEqual({ mode: 'gui', hidden: true })
  })

  it('ignores unknown arguments, including the app path electron gets in dev', () => {
    expect(parseCliArgs(['.', '--inspect=9229', '--nope', 'C:/x y/app'])).toEqual({ mode: 'gui', hidden: false })
    expect(parseCliArgs(['--unknown', '--status'])).toEqual({ mode: 'status', hidden: false })
  })

  it('matches flags exactly, not by prefix', () => {
    expect(parseCliArgs(['--status-extra', '--hiddenx', '--Cleanup'])).toEqual({ mode: 'gui', hidden: false })
  })

  it('lets the most destructive headless mode win when several are given', () => {
    expect(parseCliArgs(['--doctor-fix', '--status', '--cleanup'])).toEqual({ mode: 'cleanup', hidden: false })
    expect(parseCliArgs(['--doctor-fix', '--status'])).toEqual({ mode: 'status', hidden: false })
  })
})
