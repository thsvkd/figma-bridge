import { describe, expect, it } from 'vitest'
import { buildLaunch } from './launch'

describe('buildLaunch', () => {
  it('selects MCP mode without depending on client environment forwarding', () => {
    const l = buildLaunch({
      exePath: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\figma-bridge.exe',
    })
    expect(l).toEqual({
      command: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\figma-bridge.exe',
      args: ['--mcp'],
      env: {},
    })
  })
})
