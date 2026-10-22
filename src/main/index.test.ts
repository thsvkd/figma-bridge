import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const boundaries = vi.hoisted(() => ({
  spawn: vi.fn(),
  lock: vi.fn(),
  ready: vi.fn(),
  exit: vi.fn(),
  services: vi.fn(),
  window: vi.fn(),
  tray: vi.fn(),
}))
vi.mock('node:child_process', () => ({ spawn: boundaries.spawn }))
vi.mock('electron', () => ({ app: {
  isPackaged: false,
  getAppPath: () => 'C:/홍 길동/bridge',
  requestSingleInstanceLock: boundaries.lock,
  whenReady: boundaries.ready,
  exit: boundaries.exit,
} }))
vi.mock('electron-updater', () => ({ autoUpdater: {} }))
vi.mock('./services', () => ({ createServices: boundaries.services }))
vi.mock('./window', () => ({ createWindowController: boundaries.window }))
vi.mock('./tray', () => ({ createTray: boundaries.tray }))
vi.mock('./ipc', () => ({ registerIpc: vi.fn() }))

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  vi.resetModules()
})

describe('MCP entry point', () => {
  it.each([
    ['--mcp'],
    ['C:/old/resources/app.asar.unpacked/node_modules/cursor-talk-to-figma-mcp/dist/server.js'],
  ])('serves MCP without initializing GUI services or forwarding to its instance: %s', async (mode) => {
    const child = new EventEmitter()
    boundaries.spawn.mockReturnValue(child)
    vi.stubGlobal('process', { ...process, argv: [process.execPath, mode, '--server=example.test'] })
    await import('./index')

    expect(boundaries.spawn).toHaveBeenCalledWith(process.execPath, [
      'C:\\홍 길동\\bridge\\resources\\mcp-stdio.cjs',
      '--server=example.test',
    ], expect.objectContaining({
      env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }),
      stdio: 'inherit',
      windowsHide: true,
    }))
    expect(boundaries.lock).not.toHaveBeenCalled()
    expect(boundaries.ready).not.toHaveBeenCalled()
    expect(boundaries.services).not.toHaveBeenCalled()
    expect(boundaries.window).not.toHaveBeenCalled()
    expect(boundaries.tray).not.toHaveBeenCalled()
    child.emit('exit', 7)
    expect(boundaries.exit).toHaveBeenCalledWith(7)
  })
})
