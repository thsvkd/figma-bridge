import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import type { UpdateState } from '@shared/types'
import { UpdateManager, isAutomaticUpdateSupported, type UpdateClient } from './UpdateManager'

class FakeUpdater extends EventEmitter {
  autoDownload = true
  autoInstallOnAppQuit = true
  checkForUpdates = vi.fn(async (): Promise<unknown> => undefined)
  downloadUpdate = vi.fn(async (): Promise<unknown> => undefined)
  quitAndInstall = vi.fn()
}

function setup() {
  const updater = new FakeUpdater()
  const emitted: UpdateState[] = []
  const manager = new UpdateManager('1.0.0', updater as unknown as UpdateClient, (s) =>
    emitted.push(s)
  )
  return { updater, emitted, manager }
}

function foundUpdate(updater: FakeUpdater): void {
  updater.checkForUpdates.mockImplementationOnce(async () => {
    updater.emit('update-available', { version: '1.1.0' })
  })
}

describe('isAutomaticUpdateSupported', () => {
  it('requires a packaged win32 build that is not a smoke test', () => {
    const ok = { isPackaged: true, platform: 'win32', isSmokeTest: false }
    expect(isAutomaticUpdateSupported(ok)).toBe(true)
    expect(isAutomaticUpdateSupported({ ...ok, isPackaged: false })).toBe(false)
    expect(isAutomaticUpdateSupported({ ...ok, platform: 'darwin' })).toBe(false)
    expect(isAutomaticUpdateSupported({ ...ok, isSmokeTest: true })).toBe(false)
  })
})

describe('UpdateManager without an updater', () => {
  it('is unsupported and every command does nothing', async () => {
    const emit = vi.fn()
    const manager = new UpdateManager('1.0.0', null, emit)
    const expected = { status: 'unsupported', currentVersion: '1.0.0' }
    expect(manager.getState()).toEqual(expected)
    expect(await manager.check()).toEqual(expected)
    expect(await manager.download()).toEqual(expected)
    manager.install()
    expect(emit).not.toHaveBeenCalled()
  })
})

describe('UpdateManager with an updater', () => {
  it('turns automatic download and install-on-quit off', () => {
    const { updater, manager } = setup()
    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(manager.getState()).toEqual({ status: 'idle', currentVersion: '1.0.0' })
  })

  it('goes checking -> available on update-available', async () => {
    const { updater, emitted, manager } = setup()
    foundUpdate(updater)
    const state = await manager.check()
    expect(emitted.map((s) => s.status)).toEqual(['checking', 'available'])
    expect(state).toEqual({ status: 'available', currentVersion: '1.0.0', version: '1.1.0' })
  })

  it('goes checking -> up-to-date on update-not-available', async () => {
    const { updater, manager } = setup()
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available', { version: '1.0.0' })
    })
    expect((await manager.check()).status).toBe('up-to-date')
  })

  it('does not check again while checking', async () => {
    const { updater, manager } = setup()
    let release: () => void = () => undefined
    updater.checkForUpdates.mockImplementationOnce(
      () => new Promise<void>((resolve) => (release = resolve))
    )
    const first = manager.check()
    expect((await manager.check()).status).toBe('checking')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
    release()
    await first
  })

  it('does not check again while downloading', async () => {
    const { updater, manager } = setup()
    foundUpdate(updater)
    await manager.check()
    updater.emit('download-progress', { percent: 10 })
    expect((await manager.check()).status).toBe('downloading')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('does not check again once ready, so the downloaded update is kept', async () => {
    const { updater, manager } = setup()
    foundUpdate(updater)
    await manager.check()
    updater.emit('update-downloaded', { version: '1.1.0' })
    expect((await manager.check()).status).toBe('ready')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('shows an error event and can check again afterwards', async () => {
    const { updater, manager } = setup()
    updater.emit('error', new Error('net::ERR_INTERNET_DISCONNECTED'))
    expect(manager.getState()).toEqual({
      status: 'error',
      currentVersion: '1.0.0',
      error: 'net::ERR_INTERNET_DISCONNECTED',
    })
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit('update-not-available', { version: '1.0.0' })
    })
    expect((await manager.check()).status).toBe('up-to-date')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1)
  })

  it('turns a checkForUpdates rejection into an error and can check again', async () => {
    const { updater, manager } = setup()
    updater.checkForUpdates.mockRejectedValueOnce(new Error('timeout'))
    expect(await manager.check()).toEqual({
      status: 'error',
      currentVersion: '1.0.0',
      error: 'timeout',
    })
    foundUpdate(updater)
    expect((await manager.check()).status).toBe('available')
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2)
  })

  it('stringifies non-Error rejections', async () => {
    const { updater, manager } = setup()
    updater.checkForUpdates.mockRejectedValueOnce('boom')
    expect((await manager.check()).error).toBe('boom')
  })

  it('downloads only from available, then reaches ready', async () => {
    const { updater, manager } = setup()
    await manager.download()
    expect(updater.downloadUpdate).not.toHaveBeenCalled()

    foundUpdate(updater)
    await manager.check()
    updater.downloadUpdate.mockImplementationOnce(async () => {
      updater.emit('download-progress', { percent: 42 })
      updater.emit('update-downloaded', { version: '1.1.0' })
    })
    const state = await manager.download()
    expect(updater.downloadUpdate).toHaveBeenCalledTimes(1)
    expect(state).toEqual({
      status: 'ready',
      currentVersion: '1.0.0',
      version: '1.1.0',
      progress: 100,
    })
  })

  it('reports download progress and keeps the version', async () => {
    const { updater, manager } = setup()
    foundUpdate(updater)
    await manager.check()
    updater.emit('download-progress', { percent: 42 })
    expect(manager.getState()).toEqual({
      status: 'downloading',
      currentVersion: '1.0.0',
      version: '1.1.0',
      progress: 42,
    })
  })

  it('turns a downloadUpdate rejection into an error', async () => {
    const { updater, manager } = setup()
    foundUpdate(updater)
    await manager.check()
    updater.downloadUpdate.mockRejectedValueOnce(new Error('disk full'))
    const state = await manager.download()
    expect(state.status).toBe('error')
    expect(state.error).toBe('disk full')
  })

  it('installs only from ready, with quitAndInstall(false, true)', () => {
    const { updater, manager } = setup()
    manager.install()
    expect(updater.quitAndInstall).not.toHaveBeenCalled()
    updater.emit('update-downloaded', { version: '1.1.0' })
    manager.install()
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
