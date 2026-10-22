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

  it('routes an explicit MCP launch before any GUI or maintenance mode', () => {
    expect(parseCliArgs(['--mcp'])).toEqual({ mode: 'mcp', hidden: false })
    expect(parseCliArgs(['--mcp', '--hidden', '--cleanup'])).toEqual({ mode: 'mcp', hidden: true })
  })

  it.each([
    'C:\\Apps\\resources\\app.asar.unpacked\\node_modules\\cursor-talk-to-figma-mcp\\dist\\server.js',
    'C:/Users/홍 길동/app/node_modules/cursor-talk-to-figma-mcp/dist/server.js',
    'C:\\APPS\\NODE_MODULES\\CURSOR-TALK-TO-FIGMA-MCP\\DIST\\SERVER.JS',
  ])('keeps a legacy MCP launch out of GUI mode when its environment is missing: %s', (server) => {
    expect(parseCliArgs([server])).toEqual({ mode: 'mcp', hidden: false })
  })

  it.each(['server.js', 'C:/other/dist/server.js', '--mcp-extra',
    'C:/node_modules/cursor-talk-to-figma-mcp/dist/server.js.bak'])('does not mistake %s for MCP', (arg) => {
    expect(parseCliArgs([arg])).toEqual({ mode: 'gui', hidden: false })
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
