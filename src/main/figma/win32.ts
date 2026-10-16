import { execFile, type spawn as spawnFn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import type { FigmaDriver } from './FigmaDriver'
import { timings } from './timings'

// ---- pure helpers ----

export const KEYEVENTF_KEYUP = 0x2
export const KEYEVENTF_UNICODE = 0x4

export const VK = {
  RETURN: 0x0d,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  ESCAPE: 0x1b,
  P: 0x50,
  OEM_2: 0xbf, // '/' on US and Korean layouts
} as const

export interface KeyInput {
  wVk?: number
  wScan: number
  flags: number
}

export interface WindowInfo {
  hwnd: number
  pid: number
  visible: boolean
  /** Area of the restored (normal) window rect, so a minimized main window still ranks first. */
  area: number
}

/** PIDs from `tasklist /FI "IMAGENAME eq Figma.exe" /FO CSV /NH`. The "no tasks" notice is localized, so only CSV rows count. */
export function parseTasklistCsv(csv: string): number[] {
  const pids: number[] = []
  for (const line of csv.split(/\r?\n/)) {
    const m = /^"[^"]*","(\d+)"/.exec(line.trim())
    if (m) pids.push(Number(m[1]))
  }
  return pids
}

/** KEYEVENTF_UNICODE down/up pairs per UTF-16 code unit, so a Korean IME cannot change what gets typed. */
export function buildUnicodeKeyInputs(text: string): KeyInput[] {
  const inputs: KeyInput[] = []
  for (let i = 0; i < text.length; i++) {
    const wScan = text.charCodeAt(i)
    inputs.push({ wScan, flags: KEYEVENTF_UNICODE }, { wScan, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP })
  }
  return inputs
}

/** Presses the virtual keys in order and releases them in reverse, e.g. Ctrl+Alt+P. */
export function buildChordInputs(vks: number[]): KeyInput[] {
  return [
    ...vks.map((wVk) => ({ wVk, wScan: 0, flags: 0 })),
    ...[...vks].reverse().map((wVk) => ({ wVk, wScan: 0, flags: KEYEVENTF_KEYUP })),
  ]
}

/**
 * Fills in hardware scan codes for virtual-key events. SendInput does not do this itself, and
 * Chromium (Figma) derives KeyboardEvent.code from the scan code. Unicode events keep their wScan.
 */
export function withScanCodes(inputs: KeyInput[], mapVk: (vk: number) => number): KeyInput[] {
  return inputs.map((i) => (i.wVk ? { ...i, wScan: mapVk(i.wVk) } : i))
}

/** The largest visible top-level window owned by a Figma process. */
export function selectFigmaWindow(windows: WindowInfo[], figmaPids: number[]): number | null {
  const pids = new Set(figmaPids)
  let best: WindowInfo | null = null
  for (const w of windows) {
    if (w.visible && pids.has(w.pid) && (!best || w.area > best.area)) best = w
  }
  return best ? best.hwnd : null
}

export function findFigmaPath(candidates: string[], exists: (p: string) => boolean = existsSync): string | null {
  return candidates.find((p) => exists(p)) ?? null
}

type RunText = (file: string, args: string[]) => Promise<string>

const runText: RunText = (file, args) =>
  new Promise((resolve, reject) =>
    execFile(file, args, { windowsHide: true }, (err, stdout) => (err ? reject(err) : resolve(stdout))),
  )

/** PIDs of running Figma.exe processes; a failing tasklist counts as none. */
export async function listFigmaPids(run: RunText = runText): Promise<number[]> {
  try {
    return parseTasklistCsv(await run('tasklist', ['/FI', 'IMAGENAME eq Figma.exe', '/FO', 'CSV', '/NH']))
  } catch {
    return []
  }
}

/** Polls `cond` until it holds, sleeping `intervalMs` between checks, for at most about `timeoutMs`. */
async function pollUntil(
  cond: () => boolean | Promise<boolean>,
  timeoutMs: number,
  intervalMs: number,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  const attempts = Math.max(1, Math.ceil(timeoutMs / intervalMs))
  for (let i = 0; ; i++) {
    if (await cond()) return true
    if (i >= attempts) return false
    await sleep(intervalMs)
  }
}

// A step is either a batch of key inputs or a wait in milliseconds.
type Step = KeyInput[] | number

const press = (vk: number) => buildChordInputs([vk])

function quickActionSteps(pluginName: string): Step[] {
  return [
    press(VK.ESCAPE),
    timings.keyGapMs,
    buildChordInputs([VK.CONTROL, VK.OEM_2]),
    timings.quickActionOpenMs,
    buildUnicodeKeyInputs(pluginName),
    timings.quickActionSearchMs,
    press(VK.RETURN),
  ]
}

function runLastSteps(): Step[] {
  return [press(VK.ESCAPE), timings.keyGapMs, buildChordInputs([VK.CONTROL, VK.MENU, VK.P])]
}

// ---- thin Win32 layer ----

export interface Win32Api {
  listWindows(): WindowInfo[]
  windowPid(hwnd: number): number
  foregroundWindow(): number
  restoreIfMinimized(hwnd: number): void
  setForeground(hwnd: number): boolean
  /** Shares input state with the current foreground thread and retries SetForegroundWindow. */
  forceForeground(hwnd: number): boolean
  /** Returns how many inputs Windows accepted. */
  sendInput(inputs: KeyInput[]): number
}

let loaded: Win32Api | null = null

/** Binds user32 through koffi on first use, so importing this module never loads native code. */
export function loadWin32Api(): Win32Api {
  if (loaded) return loaded
  const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi')
  const user32 = koffi.load('user32.dll')
  const kernel32 = koffi.load('kernel32.dll')

  // HWND is declared as intptr_t so handles stay plain numbers; BOOL is int (4 bytes), not C bool.
  koffi.proto('int __stdcall FbEnumWindowsProc(intptr_t hwnd, intptr_t lParam)')
  const POINT = koffi.struct('FbPOINT', { x: 'int32_t', y: 'int32_t' })
  const RECT = koffi.struct('FbRECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' })
  const WINDOWPLACEMENT = koffi.struct('FbWINDOWPLACEMENT', {
    length: 'uint32_t',
    flags: 'uint32_t',
    showCmd: 'uint32_t',
    ptMinPosition: POINT,
    ptMaxPosition: POINT,
    rcNormalPosition: RECT,
  })
  const MOUSEINPUT = koffi.struct('FbMOUSEINPUT', {
    dx: 'int32_t',
    dy: 'int32_t',
    mouseData: 'uint32_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  })
  const KEYBDINPUT = koffi.struct('FbKEYBDINPUT', {
    wVk: 'uint16_t',
    wScan: 'uint16_t',
    dwFlags: 'uint32_t',
    time: 'uint32_t',
    dwExtraInfo: 'uintptr_t',
  })
  const HARDWAREINPUT = koffi.struct('FbHARDWAREINPUT', { uMsg: 'uint32_t', wParamL: 'uint16_t', wParamH: 'uint16_t' })
  const INPUT = koffi.struct('FbINPUT', {
    type: 'uint32_t',
    u: koffi.union({ mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT }),
  })

  const EnumWindows = user32.func('int __stdcall EnumWindows(FbEnumWindowsProc *cb, intptr_t lParam)')
  const GetWindowThreadProcessId = user32.func(
    'uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)',
  )
  const IsWindowVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)')
  const IsIconic = user32.func('int __stdcall IsIconic(intptr_t hwnd)')
  const ShowWindow = user32.func('int __stdcall ShowWindow(intptr_t hwnd, int nCmdShow)')
  const GetWindowPlacement = user32.func(
    'int __stdcall GetWindowPlacement(intptr_t hwnd, _Inout_ FbWINDOWPLACEMENT *wp)',
  )
  const SetForegroundWindow = user32.func('int __stdcall SetForegroundWindow(intptr_t hwnd)')
  const GetForegroundWindow = user32.func('intptr_t __stdcall GetForegroundWindow()')
  const AttachThreadInput = user32.func('int __stdcall AttachThreadInput(uint32_t from, uint32_t to, int attach)')
  const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t count, FbINPUT *inputs, int size)')
  const MapVirtualKeyW = user32.func('uint32_t __stdcall MapVirtualKeyW(uint32_t code, uint32_t mapType)')
  const GetCurrentThreadId = kernel32.func('uint32_t __stdcall GetCurrentThreadId()')

  const SW_RESTORE = 9
  const MAPVK_VK_TO_VSC = 0
  const INPUT_KEYBOARD = 1
  const wpSize = koffi.sizeof(WINDOWPLACEMENT)
  const inputSize = koffi.sizeof(INPUT)

  const threadOf = (hwnd: number): number => (hwnd ? GetWindowThreadProcessId(hwnd, [0]) : 0)

  const api: Win32Api = {
    listWindows() {
      const handles: number[] = []
      EnumWindows((hwnd: number) => {
        handles.push(hwnd)
        return 1
      }, 0)
      return handles.map((hwnd) => {
        const pid = [0]
        GetWindowThreadProcessId(hwnd, pid)
        const wp = {
          length: wpSize,
          flags: 0,
          showCmd: 0,
          ptMinPosition: { x: 0, y: 0 },
          ptMaxPosition: { x: 0, y: 0 },
          rcNormalPosition: { left: 0, top: 0, right: 0, bottom: 0 },
        }
        const r = GetWindowPlacement(hwnd, wp) ? wp.rcNormalPosition : null
        const area = r ? Math.max(0, r.right - r.left) * Math.max(0, r.bottom - r.top) : 0
        return { hwnd, pid: pid[0], visible: IsWindowVisible(hwnd) !== 0, area }
      })
    },
    windowPid(hwnd) {
      const pid = [0]
      if (!hwnd || !GetWindowThreadProcessId(hwnd, pid)) return 0
      return pid[0]
    },
    foregroundWindow: () => Number(GetForegroundWindow()),
    restoreIfMinimized(hwnd) {
      if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE)
    },
    setForeground: (hwnd) => SetForegroundWindow(hwnd) !== 0,
    forceForeground(hwnd) {
      const me = GetCurrentThreadId()
      const fgThread = threadOf(Number(GetForegroundWindow()))
      const attached = fgThread !== 0 && fgThread !== me && AttachThreadInput(me, fgThread, 1) !== 0
      try {
        return SetForegroundWindow(hwnd) !== 0
      } finally {
        if (attached) AttachThreadInput(me, fgThread, 0)
      }
    },
    sendInput(inputs) {
      const scanned = withScanCodes(inputs, (vk) => MapVirtualKeyW(vk, MAPVK_VK_TO_VSC))
      const events = scanned.map((i) => ({
        type: INPUT_KEYBOARD,
        u: { ki: { wVk: i.wVk ?? 0, wScan: i.wScan, dwFlags: i.flags, time: 0, dwExtraInfo: 0 } },
      }))
      return SendInput(events.length, events, inputSize)
    },
  }
  loaded = api
  return api
}

// ---- driver ----

export function createWin32FigmaDriver(deps: {
  figmaPath: () => string | null
  spawn: typeof spawnFn
  listFigmaPids: () => Promise<number[]>
  /** Test seam; defaults to the koffi binding, loaded on first use. */
  win?: Win32Api
  sleep?: (ms: number) => Promise<void>
}): FigmaDriver {
  const win = () => deps.win ?? loadWin32Api()
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)))
  // Figma PIDs seen by the last window lookup; isFigmaForeground() is synchronous and relies on them.
  let figmaPids = new Set<number>()

  const findWindow = async (): Promise<number | null> => {
    const pids = await deps.listFigmaPids()
    figmaPids = new Set(pids)
    return selectFigmaWindow(win().listWindows(), pids)
  }

  const isFigmaForeground = (): boolean => {
    const w = win()
    const fg = w.foregroundWindow()
    return fg !== 0 && figmaPids.has(w.windowPid(fg))
  }

  const start = (args: string[]): Promise<void> => {
    const file = deps.figmaPath()
    if (!file) return Promise.reject(new Error('Figma desktop app is not installed'))
    return new Promise((resolve, reject) => {
      const child = deps.spawn(file, args, { detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', reject)
      child.once('spawn', () => {
        child.unref()
        resolve()
      })
    })
  }

  const runSteps = async (steps: Step[]): Promise<void> => {
    for (const step of steps) {
      if (typeof step === 'number') {
        await sleep(step)
        continue
      }
      if (!isFigmaForeground()) throw new Error('Figma lost focus; stopped sending keys')
      if (win().sendInput(step) !== step.length) throw new Error('SendInput was blocked')
    }
  }

  const restoreForeground = (handle: number): void => {
    if (!handle) return
    const w = win()
    if (!w.setForeground(handle) || w.foregroundWindow() !== handle) w.forceForeground(handle)
  }

  return {
    isInstalled: () => deps.figmaPath() !== null,
    isRunning: async () => (await deps.listFigmaPids()).length > 0,
    async launch() {
      if ((await deps.listFigmaPids()).length > 0) return
      await start([])
    },
    waitForWindow: (timeoutMs) =>
      pollUntil(async () => (await findWindow()) !== null, timeoutMs, timings.windowPollMs, sleep),
    async focus() {
      const hwnd = await findWindow()
      if (hwnd === null) return false
      const w = win()
      w.restoreIfMinimized(hwnd)
      if (!w.setForeground(hwnd) || !isFigmaForeground()) w.forceForeground(hwnd)
      return pollUntil(isFigmaForeground, timings.focusTimeoutMs, timings.focusPollMs, sleep)
    },
    isFigmaForeground,
    sendQuickAction: (pluginName) => runSteps(quickActionSteps(pluginName)),
    sendRunLast: () => runSteps(runLastSteps()),
    openPluginPage: (url) => start([url]),
    captureForeground: () => win().foregroundWindow(),
    restoreForeground,
  }
}
