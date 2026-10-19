import { Menu, nativeImage, Tray } from 'electron'
import type { BridgeState, BridgeStatus, UpdateState } from '@shared/types'
import { appMessages, trayMessages as m } from './messages'

const COLORS: Record<BridgeStatus, [number, number, number]> = {
  off: [138, 144, 155],
  'relay-only': [245, 158, 11],
  connected: [34, 197, 94],
}

// A filled dot drawn into a BGRA bitmap, so the three states need no image files.
function dotIcon(rgb: [number, number, number]) {
  const size = 32
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const alpha = Math.max(0, Math.min(1, 14.5 - Math.hypot(x - c, y - c)))
      const o = (y * size + x) * 4
      buf[o] = rgb[2]
      buf[o + 1] = rgb[1]
      buf[o + 2] = rgb[0]
      buf[o + 3] = Math.round(alpha * 255)
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size, scaleFactor: 2 })
}

export interface TrayActions {
  open(): void
  turnOn(): void
  turnOff(): void
  attachPlugin(): void
  quit(): void
}

export interface TrayController {
  setBridge(state: BridgeState): void
  setUpdate(state: UpdateState): void
}

export function createTray(actions: TrayActions, initial: BridgeState): TrayController {
  const icons: Record<BridgeStatus, Electron.NativeImage> = {
    off: dotIcon(COLORS.off),
    'relay-only': dotIcon(COLORS['relay-only']),
    connected: dotIcon(COLORS.connected),
  }
  const tray = new Tray(icons[initial.status])
  let bridge = initial
  let update: UpdateState | null = null

  function updateLine(): string | null {
    if (update?.status === 'available') return appMessages.updateAvailable(update.version ?? '')
    if (update?.status === 'ready') return appMessages.updateReady
    return null
  }

  function render(): void {
    tray.setImage(icons[bridge.status])
    tray.setToolTip(m.tooltip[bridge.status])
    const on = bridge.status !== 'off'
    const line = updateLine()
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: m.statusLine[bridge.status], enabled: false },
        ...(line ? [{ label: line, click: actions.open }] : []),
        { type: 'separator' },
        {
          label: on ? m.turnOff : m.turnOn,
          enabled: !bridge.busy,
          click: on ? actions.turnOff : actions.turnOn,
        },
        ...(bridge.status === 'relay-only'
          ? [{ label: m.attachPlugin, enabled: !bridge.busy, click: actions.attachPlugin }]
          : []),
        { label: m.open, click: actions.open },
        { type: 'separator' },
        { label: m.quit, click: actions.quit },
      ]),
    )
  }

  tray.on('click', actions.open)
  render()

  return {
    setBridge(state) {
      bridge = state
      render()
    },
    setUpdate(state) {
      update = state
      render()
    },
  }
}
