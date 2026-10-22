// Windows integration test of the packaged launcher, stdio and window activation.
// Inspector hooks observe/click the real tray callbacks; no test hooks ship in the app.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { setTimeout as sleep } from 'node:timers/promises'
import WebSocket from 'ws'

const require = createRequire(import.meta.url)
const koffi = require('koffi')
const user32 = koffi.load('user32.dll')
const enumProc = koffi.proto('int __stdcall McpSmokeEnum(intptr_t hwnd, intptr_t param)')
const enumWindows = user32.func('int __stdcall EnumWindows(McpSmokeEnum *callback, intptr_t param)')
const isVisible = user32.func('int __stdcall IsWindowVisible(intptr_t hwnd)')
const windowPid = user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)')
const getText = user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, _Out_ uint16_t *text, int max)')
const foreground = user32.func('intptr_t __stdcall GetForegroundWindow()')

function bridgeWindows() {
  const result = []
  const callback = koffi.register((hwnd) => {
    const title = Buffer.alloc(1024)
    getText(hwnd, title, 512)
    if (title.toString('utf16le').split('\0')[0] === '피그마 연결') {
      const pid = [0]
      windowPid(hwnd, pid)
      result.push({ hwnd, pid: pid[0], visible: !!isVisible(hwnd) })
    }
    return 1
  }, koffi.pointer(enumProc))
  try { enumWindows(callback, 0) }
  finally { koffi.unregister(callback) }
  return result
}

async function until(condition, label) {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const value = await condition()
    if (value) return value
    await sleep(50)
  }
  throw new Error(`Timed out: ${label}`)
}

const executable = path.resolve(process.argv[2] ?? 'dist/win-unpacked/figma-bridge.exe')
const resources = path.join(path.dirname(executable), 'resources')
const legacy = path.join(resources, 'app.asar.unpacked/node_modules/cursor-talk-to-figma-mcp/dist/server.js')
const sandbox = await mkdtemp(path.join(tmpdir(), 'figma-bridge-mcp-smoke-'))
const env = {
  ...process.env, FIGMA_BRIDGE_HOME: path.join(sandbox, 'home'), FIGMA_BRIDGE_SMOKE_TEST: '1',
}
delete env.ELECTRON_RUN_AS_NODE
const userData = `--user-data-dir=${path.join(sandbox, 'electron')}`
const initialWindows = new Set(bridgeWindows().map((window) => window.hwnd))
const sessions = new Set()

function session(name, args = ['--mcp'], extraEnv = {}) {
  const child = spawn(executable, args, {
    env: { ...env, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: false,
  })
  let id = 0
  let stderr = ''
  const pending = new Map()
  const lines = createInterface({ input: child.stdout })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const exited = once(child, 'exit')
  lines.on('line', (line) => {
    if (!line.trim()) return // Electron on Windows can emit a leading blank line.
    const message = JSON.parse(line)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  async function request(method, params = {}) {
    const requestId = ++id
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${name} ${method}: ${stderr}`)), 10_000)
      pending.set(requestId, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else resolve(message.result)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n')
    })
  }
  const client = {
    request,
    async initialize() {
      const result = await request('initialize', {
        protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name, version: '1' },
      })
      assert.equal(result.serverInfo.name, 'TalkToFigmaMCP')
      const tools = (await request('tools/list')).tools
      assert.equal(tools.length, 40)
      assert.deepEqual(await request('ping'), {})
      return tools.length
    },
    async close() {
      child.stdin.end()
      let timer
      try {
        const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${name} did not exit on EOF`)), 10_000) })
        const [code] = await Promise.race([exited, timeout])
        assert.equal(code, 0, stderr)
      } finally { clearTimeout(timer) }
      lines.close()
      sessions.delete(client)
    },
  }
  sessions.add(client)
  return client
}

async function quiet(label, action) {
  const unexpected = new Set()
  const startFocus = foreground()
  const sample = () => {
    for (const window of bridgeWindows()) {
      if (initialWindows.has(window.hwnd)) continue
      if (window.visible || window.hwnd === foreground()) unexpected.add(JSON.stringify(window))
    }
  }
  const timer = setInterval(sample, 10)
  try {
    await action()
    await sleep(300)
    sample()
    assert.deepEqual([...unexpected], [], `${label}: unexpected window/activation`)
    assert.equal(foreground(), startFocus, `${label}: foreground changed`)
    console.log(`[mcp-smoke] PASS ${label}: no window/activation`)
  } finally { clearInterval(timer) }
}

let gui
let direct
let debuggerSocket
let evaluate
try {
  await quiet('GUI stopped: new + legacy launch without client env', async () => {
    for (const args of [['--mcp'], [legacy]]) {
      const client = session('cold', args)
      await client.initialize()
      await client.close()
    }
  })

  gui = spawn(executable, ['--hidden', '--inspect-brk=0', userData], {
    env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let stderr = ''
  gui.stdout.resume()
  gui.stderr.on('data', (chunk) => { stderr += chunk })
  const address = await until(() => stderr.match(/ws:\/\/127\.0\.0\.1:\d+\/[\w-]+/)?.[0], 'inspector address')
  debuggerSocket = new WebSocket(address)
  await once(debuggerSocket, 'open')
  let commandId = 0
  const replies = new Map()
  let paused
  debuggerSocket.on('message', (raw) => {
    const message = JSON.parse(raw)
    if (message.id) { replies.get(message.id)?.(message); replies.delete(message.id) }
    if (message.method === 'Debugger.paused') paused = message.params
  })
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++commandId
    const timer = setTimeout(() => reject(new Error(`Inspector timeout: ${method}`)), 10_000)
    replies.set(id, (message) => { clearTimeout(timer); message.error ? reject(new Error(JSON.stringify(message.error))) : resolve(message.result) })
    debuggerSocket.send(JSON.stringify({ id, method, params }))
  })
  await command('Debugger.enable')
  await command('Runtime.runIfWaitingForDebugger')
  await until(() => paused, 'main entry pause')
  const patch = await command('Debugger.evaluateOnCallFrame', {
    callFrameId: paused.callFrames[0].callFrameId,
    expression: `globalThis.__smokeElectron = require('electron');
      globalThis.__smokeOriginalMenu = __smokeElectron.Tray.prototype.setContextMenu;
      __smokeElectron.Tray.prototype.setContextMenu = function(menu) {
        globalThis.__smokeTray = this; globalThis.__smokeMenu = menu;
        return __smokeOriginalMenu.call(this, menu);
      };`,
  })
  assert.equal(patch.exceptionDetails, undefined, JSON.stringify(patch))
  evaluate = async (expression) => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    assert.equal(result.exceptionDetails, undefined, JSON.stringify(result))
    return result.result.value
  }
  await command('Debugger.resume')
  await until(() => evaluate('!!globalThis.__smokeTray'), 'tray ready')
  assert.equal(await evaluate('__smokeElectron.BrowserWindow.getAllWindows().length'), 0)
  await quiet('tray: reconnect + simultaneous independent streams', async () => {
    const first = session('codex-protocol')
    const second = session('claude-protocol')
    await Promise.all([first.initialize(), second.initialize()])
    await first.close()
    const reconnect = session('codex-protocol-reconnect')
    await reconnect.initialize()
    assert.deepEqual(await second.request('ping'), {})
    await Promise.all([second.close(), reconnect.close()])
  })
  assert.equal(await evaluate('__smokeElectron.BrowserWindow.getAllWindows().length'), 0)

  direct = spawn(executable, [userData], { env, stdio: 'ignore', windowsHide: true })
  await until(() => direct.exitCode !== null, 'explicit GUI launcher exit')
  assert.equal(direct.exitCode, 0)
  await until(() => evaluate('__smokeElectron.BrowserWindow.getAllWindows().some(w => w.isVisible())'), 'explicit GUI launch')
  console.log('[mcp-smoke] PASS explicit app launch shows existing window')
  await evaluate('__smokeElectron.BrowserWindow.getAllWindows()[0].close()')
  await until(async () => !(await evaluate('__smokeElectron.BrowserWindow.getAllWindows()[0].isVisible()')), 'hide to tray')
  await quiet('existing hidden window: legacy missing-env reconnect', async () => {
    const client = session('legacy-reconnect', [legacy])
    await client.initialize()
    await client.close()
  })
  await evaluate('__smokeMenu.items.find(item => item.label === "창 열기").click()')
  assert.equal(await evaluate('__smokeElectron.BrowserWindow.getAllWindows()[0].isVisible()'), true)
  console.log('[mcp-smoke] PASS real tray Open callback shows window')
  console.log(`[mcp-smoke] PASS packaged app ${await evaluate('__smokeElectron.app.getVersion()')}`)
} finally {
  for (const client of sessions) await client.close().catch((error) => console.error(error.message))
  if (direct && direct.exitCode === null) direct.kill() // failed-test cleanup only
  if (evaluate) await evaluate('__smokeElectron.app.quit()').catch(() => undefined)
  debuggerSocket?.close()
  if (gui) await until(() => gui.exitCode !== null, 'GUI normal quit')
  assert.equal(path.dirname(sandbox), path.resolve(tmpdir()))
  assert.ok(path.basename(sandbox).startsWith('figma-bridge-mcp-smoke-'))
  await rm(sandbox, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
