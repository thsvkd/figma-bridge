import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  VK,
  buildChordInputs,
  buildUnicodeKeyInputs,
  createWin32FigmaDriver,
  findFigmaPath,
  listFigmaPids,
  parseTasklistCsv,
  selectFigmaWindow,
  withScanCodes,
  type KeyInput,
  type Win32Api,
  type WindowInfo,
} from './win32'

const FIGMA = 'C:\\Users\\홍 길동\\AppData\\Local\\Figma\\Figma.exe'

describe('parseTasklistCsv', () => {
  it('extracts PIDs from tasklist CSV output', () => {
    const csv =
      '"Figma.exe","1234","Console","1","250,112 K"\r\n' + '"Figma.exe","5678","Console","1","98,004 K"\r\n'
    expect(parseTasklistCsv(csv)).toEqual([1234, 5678])
  })

  it('returns an empty list when no task matches (English and localized)', () => {
    expect(parseTasklistCsv('INFO: No tasks are running which match the specified criteria.\r\n')).toEqual([])
    expect(parseTasklistCsv('정보: 지정된 조건에 일치하는 작업이 실행되고 있지 않습니다.\r\n')).toEqual([])
    expect(parseTasklistCsv('')).toEqual([])
  })
})

describe('buildUnicodeKeyInputs', () => {
  it('emits a down/up pair per UTF-16 code unit', () => {
    const inputs = buildUnicodeKeyInputs('Talk To')
    expect(inputs).toHaveLength(14)
    'Talk To'.split('').forEach((ch, i) => {
      expect(inputs[2 * i]).toEqual({ wScan: ch.charCodeAt(0), flags: KEYEVENTF_UNICODE })
      expect(inputs[2 * i + 1]).toEqual({ wScan: ch.charCodeAt(0), flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP })
    })
  })

  it('sends Hangul and surrogate pairs as raw code units', () => {
    expect(buildUnicodeKeyInputs('한').map((i) => i.wScan)).toEqual([0xd55c, 0xd55c])
    expect(buildUnicodeKeyInputs('😀').map((i) => i.wScan)).toEqual([0xd83d, 0xd83d, 0xde00, 0xde00])
  })
})

describe('buildChordInputs', () => {
  it('presses keys in order and releases them in reverse', () => {
    expect(buildChordInputs([VK.CONTROL, VK.MENU, VK.P])).toEqual([
      { wVk: VK.CONTROL, wScan: 0, flags: 0 },
      { wVk: VK.MENU, wScan: 0, flags: 0 },
      { wVk: VK.P, wScan: 0, flags: 0 },
      { wVk: VK.P, wScan: 0, flags: KEYEVENTF_KEYUP },
      { wVk: VK.MENU, wScan: 0, flags: KEYEVENTF_KEYUP },
      { wVk: VK.CONTROL, wScan: 0, flags: KEYEVENTF_KEYUP },
    ])
  })
})

describe('withScanCodes', () => {
  it('fills scan codes for virtual keys and leaves unicode input alone', () => {
    const scans: Record<number, number> = { [VK.CONTROL]: 0x1d, [VK.OEM_2]: 0x35 }
    const inputs = [...buildChordInputs([VK.CONTROL, VK.OEM_2]), ...buildUnicodeKeyInputs('한')]
    expect(withScanCodes(inputs, (vk) => scans[vk])).toEqual([
      { wVk: VK.CONTROL, wScan: 0x1d, flags: 0 },
      { wVk: VK.OEM_2, wScan: 0x35, flags: 0 },
      { wVk: VK.OEM_2, wScan: 0x35, flags: KEYEVENTF_KEYUP },
      { wVk: VK.CONTROL, wScan: 0x1d, flags: KEYEVENTF_KEYUP },
      { wScan: 0xd55c, flags: KEYEVENTF_UNICODE },
      { wScan: 0xd55c, flags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP },
    ])
  })
})

describe('selectFigmaWindow', () => {
  it('picks the largest visible window owned by a Figma process', () => {
    const windows: WindowInfo[] = [
      { hwnd: 1, pid: 10, visible: true, area: 100 },
      { hwnd: 2, pid: 10, visible: true, area: 900 },
      { hwnd: 3, pid: 10, visible: false, area: 5000 },
      { hwnd: 4, pid: 99, visible: true, area: 9000 },
      { hwnd: 5, pid: 11, visible: true, area: 500 },
    ]
    expect(selectFigmaWindow(windows, [10, 11])).toBe(2)
  })

  it('returns null when Figma has no visible window', () => {
    expect(selectFigmaWindow([{ hwnd: 3, pid: 10, visible: false, area: 5000 }], [10])).toBeNull()
    expect(selectFigmaWindow([{ hwnd: 1, pid: 10, visible: true, area: 5000 }], [])).toBeNull()
  })
})

describe('findFigmaPath', () => {
  it('returns the first existing candidate', () => {
    const exists = (p: string) => p === 'B' || p === 'C'
    expect(findFigmaPath(['A', 'B', 'C'], exists)).toBe('B')
  })

  it('returns null when no candidate exists', () => {
    expect(findFigmaPath(['A', 'B'], () => false)).toBeNull()
  })
})

describe('listFigmaPids', () => {
  it('runs tasklist filtered to Figma.exe and parses its CSV', async () => {
    const calls: Array<{ file: string; args: string[] }> = []
    const pids = await listFigmaPids(async (file, args) => {
      calls.push({ file, args })
      return '"Figma.exe","42","Console","1","1 K"\r\n'
    })
    expect(pids).toEqual([42])
    expect(calls).toEqual([
      { file: 'tasklist', args: ['/FI', 'IMAGENAME eq Figma.exe', '/FO', 'CSV', '/NH'] },
    ])
  })

  it('treats a tasklist failure as no Figma process', async () => {
    expect(
      await listFigmaPids(async () => {
        throw new Error('tasklist missing')
      }),
    ).toEqual([])
  })
})

// ---- driver with fakes ----

const FIGMA_PID = 10
const FIGMA_HWND = 200
const OTHER_HWND = 300

class FakeWin implements Win32Api {
  windows: WindowInfo[] = [{ hwnd: FIGMA_HWND, pid: FIGMA_PID, visible: true, area: 1000 }]
  fg = OTHER_HWND
  minimized = false
  allowSet = true
  allowForce = true
  sent: KeyInput[][] = []
  setCalls: number[] = []
  forceCalls: number[] = []
  restored: number[] = []
  onSend: (batch: KeyInput[]) => void = () => {}

  listWindows() {
    return this.windows
  }
  windowPid(hwnd: number) {
    return this.windows.find((w) => w.hwnd === hwnd)?.pid ?? 0
  }
  foregroundWindow() {
    return this.fg
  }
  restoreIfMinimized(hwnd: number) {
    if (this.minimized) this.restored.push(hwnd)
    this.minimized = false
  }
  setForeground(hwnd: number) {
    this.setCalls.push(hwnd)
    if (this.allowSet) this.fg = hwnd
    return this.allowSet
  }
  forceForeground(hwnd: number) {
    this.forceCalls.push(hwnd)
    if (this.allowForce) this.fg = hwnd
    return this.allowForce
  }
  sendInput(inputs: KeyInput[]) {
    this.sent.push(inputs)
    this.onSend(inputs)
    return inputs.length
  }
}

function makeDriver(opts: { win?: FakeWin; figmaPath?: string | null; pids?: number[] } = {}) {
  const win = opts.win ?? new FakeWin()
  const spawned: Array<{ file: string; args: readonly string[]; options: unknown }> = []
  let spawnError: Error | null = null
  const sleeps: number[] = []
  const pids = opts.pids ?? [FIGMA_PID]
  const spawn = ((file: string, args: readonly string[], options: unknown) => {
    spawned.push({ file, args, options })
    const child = Object.assign(new EventEmitter(), { unref: () => {} })
    queueMicrotask(() => (spawnError ? child.emit('error', spawnError) : child.emit('spawn')))
    return child
  }) as unknown as typeof import('node:child_process').spawn
  const driver = createWin32FigmaDriver({
    figmaPath: () => (opts.figmaPath === undefined ? FIGMA : opts.figmaPath),
    spawn,
    listFigmaPids: async () => pids,
    win,
    sleep: async (ms) => {
      sleeps.push(ms)
    },
  })
  return {
    driver,
    win,
    spawned,
    sleeps,
    pids,
    failSpawn: (e: Error) => {
      spawnError = e
    },
  }
}

const press = (vk: number) => buildChordInputs([vk])

describe('createWin32FigmaDriver', () => {
  it('isInstalled follows figmaPath', () => {
    expect(makeDriver().driver.isInstalled()).toBe(true)
    expect(makeDriver({ figmaPath: null }).driver.isInstalled()).toBe(false)
  })

  it('isInstalled works with findFigmaPath over the candidates', () => {
    const candidates = ['C:\\missing\\Figma.exe', FIGMA]
    const { driver } = createDriverWithPath(() => findFigmaPath(candidates, (p) => p === FIGMA))
    expect(driver.isInstalled()).toBe(true)
  })

  it('isRunning is true only when a Figma process exists', async () => {
    expect(await makeDriver().driver.isRunning()).toBe(true)
    expect(await makeDriver({ pids: [] }).driver.isRunning()).toBe(false)
  })

  it('launch does not spawn when Figma is already running', async () => {
    const { driver, spawned } = makeDriver()
    await driver.launch()
    expect(spawned).toEqual([])
  })

  it('launch spawns Figma detached when it is not running', async () => {
    const { driver, spawned } = makeDriver({ pids: [] })
    await driver.launch()
    expect(spawned).toHaveLength(1)
    expect(spawned[0].file).toBe(FIGMA)
    expect(spawned[0].args).toEqual([])
    expect(spawned[0].options).toMatchObject({ detached: true, stdio: 'ignore' })
  })

  it('launch rejects when Figma is not installed or fails to start', async () => {
    await expect(makeDriver({ figmaPath: null, pids: [] }).driver.launch()).rejects.toThrow()
    const ctx = makeDriver({ pids: [] })
    ctx.failSpawn(new Error('ENOENT'))
    await expect(ctx.driver.launch()).rejects.toThrow('ENOENT')
  })

  it('openPluginPage hands the URL to the Figma executable', async () => {
    const { driver, spawned } = makeDriver()
    await driver.openPluginPage('https://www.figma.com/community/plugin/1')
    expect(spawned).toHaveLength(1)
    expect(spawned[0].file).toBe(FIGMA)
    expect(spawned[0].args).toEqual(['https://www.figma.com/community/plugin/1'])
  })

  it('waitForWindow polls until a Figma window shows up', async () => {
    const win = new FakeWin()
    const real = win.windows
    win.windows = []
    const ctx = makeDriver({ win })
    let polls = 0
    win.listWindows = () => (++polls >= 3 ? real : [])
    expect(await ctx.driver.waitForWindow(10_000)).toBe(true)
    expect(polls).toBe(3)
  })

  it('waitForWindow gives up after the timeout', async () => {
    const win = new FakeWin()
    win.windows = []
    const ctx = makeDriver({ win })
    expect(await ctx.driver.waitForWindow(1000)).toBe(false)
    const total = ctx.sleeps.reduce((a, b) => a + b, 0)
    expect(total).toBeGreaterThanOrEqual(1000)
    expect(total).toBeLessThan(1000 + 500)
  })

  it('focus restores a minimized window and uses SetForegroundWindow first', async () => {
    const win = new FakeWin()
    win.minimized = true
    const { driver } = makeDriver({ win })
    expect(await driver.focus()).toBe(true)
    expect(win.restored).toEqual([FIGMA_HWND])
    expect(win.setCalls).toEqual([FIGMA_HWND])
    expect(win.forceCalls).toEqual([])
    expect(driver.isFigmaForeground()).toBe(true)
  })

  it('focus falls back to attaching thread input when SetForegroundWindow is refused', async () => {
    const win = new FakeWin()
    win.allowSet = false
    const { driver } = makeDriver({ win })
    expect(await driver.focus()).toBe(true)
    expect(win.forceCalls).toEqual([FIGMA_HWND])
  })

  it('focus returns false when Figma never becomes foreground', async () => {
    const win = new FakeWin()
    win.allowSet = false
    win.allowForce = false
    const ctx = makeDriver({ win })
    expect(await ctx.driver.focus()).toBe(false)
    expect(ctx.driver.isFigmaForeground()).toBe(false)
    expect(ctx.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1000)
  })

  it('focus returns false without a Figma window', async () => {
    const win = new FakeWin()
    win.windows = []
    const { driver } = makeDriver({ win })
    expect(await driver.focus()).toBe(false)
    expect(win.setCalls).toEqual([])
  })

  it('sendQuickAction sends Esc, Ctrl+/, the name as unicode, then Enter', async () => {
    const { driver, win } = makeDriver()
    await driver.focus()
    await driver.sendQuickAction('Talk To')
    expect(win.sent).toEqual([
      press(VK.ESCAPE),
      buildChordInputs([VK.CONTROL, VK.OEM_2]),
      buildUnicodeKeyInputs('Talk To'),
      press(VK.RETURN),
    ])
  })

  it('sendRunLast sends Esc then Ctrl+Alt+P', async () => {
    const { driver, win } = makeDriver()
    await driver.focus()
    await driver.sendRunLast()
    expect(win.sent).toEqual([press(VK.ESCAPE), buildChordInputs([VK.CONTROL, VK.MENU, VK.P])])
  })

  it('send* refuses to type when Figma is not foreground', async () => {
    const { driver, win } = makeDriver()
    await expect(driver.sendQuickAction('Talk To')).rejects.toThrow()
    await expect(driver.sendRunLast()).rejects.toThrow()
    expect(win.sent).toEqual([])
  })

  it('sendQuickAction stops as soon as focus leaves Figma', async () => {
    const { driver, win } = makeDriver()
    await driver.focus()
    win.onSend = (batch) => {
      if (batch[0].wVk === VK.CONTROL) win.fg = OTHER_HWND
    }
    await expect(driver.sendQuickAction('Talk To')).rejects.toThrow()
    expect(win.sent).toEqual([press(VK.ESCAPE), buildChordInputs([VK.CONTROL, VK.OEM_2])])
  })

  it('send* rejects when SendInput is blocked', async () => {
    const { driver, win } = makeDriver()
    await driver.focus()
    win.sendInput = () => 0
    await expect(driver.sendRunLast()).rejects.toThrow()
  })

  it('captureForeground and restoreForeground round-trip the caller window', async () => {
    const { driver, win } = makeDriver()
    const handle = driver.captureForeground()
    expect(handle).toBe(OTHER_HWND)
    await driver.focus()
    win.allowSet = false
    driver.restoreForeground(handle)
    expect(win.setCalls.at(-1)).toBe(OTHER_HWND)
    expect(win.forceCalls).toEqual([OTHER_HWND])
    expect(win.fg).toBe(OTHER_HWND)
  })

  it('restoreForeground ignores an empty handle', () => {
    const { driver, win } = makeDriver()
    driver.restoreForeground(0)
    expect(win.setCalls).toEqual([])
    expect(win.forceCalls).toEqual([])
  })
})

function createDriverWithPath(figmaPath: () => string | null) {
  return {
    driver: createWin32FigmaDriver({
      figmaPath,
      spawn: (() => {
        throw new Error('not used')
      }) as unknown as typeof import('node:child_process').spawn,
      listFigmaPids: async () => [],
    }),
  }
}
