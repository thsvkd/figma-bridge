import { describe, expect, it } from 'vitest'
import { buildLaunch } from './launch'

describe('buildLaunch', () => {
  it('runs the unpacked bundled server with the app executable in node mode', () => {
    const l = buildLaunch({
      exePath: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\figma-bridge.exe',
      resourcesPath: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\resources',
    })
    expect(l).toEqual({
      command: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\figma-bridge.exe',
      args: [
        'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\resources\\app.asar.unpacked\\node_modules\\cursor-talk-to-figma-mcp\\dist\\server.js',
      ],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    })
  })
})
