import { join } from 'node:path'
import { BrowserWindow, nativeImage, shell } from 'electron'
import { appMessages } from './messages'

export interface WindowController {
  /** Shows the window, creating it first if it does not exist. */
  show(): void
  send(channel: string, payload: unknown): void
  /** After this, closing really closes: the app is quitting. */
  allowClose(): void
}

export function createWindowController(opts: { appPath: string; showOnCreate: boolean }): WindowController {
  let win: BrowserWindow | null = null
  let quitting = false

  function create(show: boolean): BrowserWindow {
    const w = new BrowserWindow({
      width: 520,
      height: 760,
      minWidth: 420,
      minHeight: 480,
      show,
      autoHideMenuBar: true,
      title: appMessages.windowTitle,
      icon: nativeImage.createFromPath(join(opts.appPath, 'resources', 'icon.png')),
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
      },
    })
    // Closing hides to the tray so the relay keeps running (spec D7).
    w.on('close', (event) => {
      if (quitting) return
      event.preventDefault()
      w.hide()
    })
    w.on('closed', () => {
      win = null
    })
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (/^https:\/\//.test(url)) void shell.openExternal(url)
      return { action: 'deny' }
    })
    w.webContents.on('will-navigate', (event) => event.preventDefault())

    const devUrl = process.env.ELECTRON_RENDERER_URL
    if (devUrl) void w.loadURL(devUrl)
    else void w.loadFile(join(__dirname, '../renderer/index.html'))
    return w
  }

  // Started with --hidden: the window is created lazily the first time it is asked for.
  if (opts.showOnCreate) win = create(true)

  return {
    show() {
      if (!win) win = create(true)
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    },
    send(channel, payload) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
    },
    allowClose() {
      quitting = true
    },
  }
}
