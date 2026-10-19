import { createServer, type Server } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { PortInUseError, Relay, type RelayStatus } from './Relay'

type Msg = Record<string, any>

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer()
    s.once('error', reject)
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number }
      s.close(() => resolve(port))
    })
  })
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!cond()) {
    if (Date.now() > end) throw new Error('timeout waiting for condition')
    await wait(10)
  }
}

interface Client {
  ws: WebSocket
  seen: Msg[]
}

const openClients: WebSocket[] = []

async function connect(port: number, headers?: Record<string, string>): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { headers })
  const seen: Msg[] = []
  ws.on('message', (d) => seen.push(JSON.parse(d.toString())))
  openClients.push(ws)
  await new Promise<void>((resolve, reject) => {
    ws.once('open', () => resolve())
    ws.once('error', reject)
  })
  return { ws, seen }
}

async function join(c: Client, channel: string): Promise<void> {
  c.ws.send(JSON.stringify({ type: 'join', channel, id: `${channel}-join` }))
  await until(() => c.seen.some((m) => m.type === 'system' && m.channel === channel))
}

let relay: Relay | undefined
let blocker: Server | undefined

afterEach(async () => {
  for (const ws of openClients.splice(0)) ws.terminate()
  await relay?.stop()
  relay = undefined
  if (blocker) {
    await new Promise<void>((r) => blocker!.close(() => r()))
    blocker = undefined
  }
})

async function startRelay(): Promise<{ relay: Relay; port: number }> {
  const port = await freePort()
  relay = new Relay({ port })
  await relay.start()
  return { relay, port }
}

describe('Relay', () => {
  it('bridges commands and results between differently named channels', async () => {
    const { port } = await startRelay()
    const harness = await connect(port)
    const plugin = await connect(port, { origin: 'null' })
    await join(harness, 'figma')
    await join(plugin, 'random-9xk')

    harness.ws.send(
      JSON.stringify({
        type: 'message',
        channel: 'figma',
        message: { id: 'cmd1', command: 'get_document_info' },
      }),
    )
    await until(() =>
      plugin.seen.some(
        (m) =>
          m.type === 'broadcast' &&
          m.message?.command === 'get_document_info' &&
          m.channel === 'random-9xk',
      ),
    )

    plugin.ws.send(
      JSON.stringify({
        type: 'message',
        channel: 'random-9xk',
        message: { id: 'cmd1', result: { name: 'MyFile' } },
      }),
    )
    await until(() =>
      harness.seen.some(
        (m) =>
          m.type === 'broadcast' && m.message?.result?.name === 'MyFile' && m.channel === 'figma',
      ),
    )
  })

  it('relays progress_update with the receiver channel swapped in', async () => {
    const { port } = await startRelay()
    const harness = await connect(port)
    const plugin = await connect(port, { origin: 'null' })
    await join(harness, 'figma')
    await join(plugin, 'p-chan')

    plugin.ws.send(JSON.stringify({ type: 'progress_update', channel: 'p-chan', message: { pct: 50 } }))
    await until(() =>
      harness.seen.some((m) => m.type === 'progress_update' && m.channel === 'figma' && m.message.pct === 50),
    )
  })

  it('classifies a client as plugin by user-agent when no Origin is sent', async () => {
    const { relay: r, port } = await startRelay()
    const plugin = await connect(port, { 'user-agent': 'Mozilla/5.0 Figma' })
    await join(plugin, 'x')
    expect(r.status().figmaJoined).toBe(1)
    expect(r.status().harnessJoined).toBe(0)
  })

  it('rejects join without a channel and message before join', async () => {
    const { port } = await startRelay()
    const c = await connect(port)
    c.ws.send(JSON.stringify({ type: 'join' }))
    await until(() => c.seen.some((m) => m.type === 'error' && /Channel name/.test(m.message)))
    c.ws.send(JSON.stringify({ type: 'message', message: {} }))
    await until(() => c.seen.some((m) => m.type === 'error' && /join the channel first/.test(m.message)))
  })

  it('ignores unparsable frames without dropping the client', async () => {
    const { relay: r, port } = await startRelay()
    const c = await connect(port)
    c.ws.send('not json')
    await join(c, 'still-alive')
    expect(r.status().harnessJoined).toBe(1)
  })

  it('status() matches GET /status and reports readiness', async () => {
    const { relay: r, port } = await startRelay()
    const harness = await connect(port)
    const plugin = await connect(port, { origin: 'null' })
    await join(harness, 'figma')
    await join(plugin, 'random')

    const http = (await (await fetch(`http://127.0.0.1:${port}/status`)).json()) as RelayStatus
    const local = r.status()
    expect(local.relay).toBe('figma-bridge')
    expect(local.figmaJoined).toBe(1)
    expect(local.harnessJoined).toBe(1)
    expect(local.ready).toBe(true)
    expect(local.port).toBe(port)
    expect(http).toEqual(local)
    expect(local.channels.sort()).toEqual(['figma', 'random'])
  })

  it('answers OPTIONS with CORS headers and other paths with the legacy body', async () => {
    const { port } = await startRelay()
    const opt = await fetch(`http://127.0.0.1:${port}/`, { method: 'OPTIONS' })
    expect(opt.status).toBe(204)
    expect(opt.headers.get('access-control-allow-origin')).toBe('*')
    expect(opt.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS')
    const root = await fetch(`http://127.0.0.1:${port}/`)
    expect(await root.text()).toBe('WebSocket server running')
    expect(root.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('stops counting a client after it disconnects', async () => {
    const { relay: r, port } = await startRelay()
    const c = await connect(port)
    await join(c, 'gone')
    c.ws.close()
    await until(() => r.status().harness === 0)
    expect(r.status().ready).toBe(false)
  })

  it('start() twice keeps a single server and resolves immediately', async () => {
    const { relay: r, port } = await startRelay()
    await r.start()
    expect(r.running).toBe(true)
    const res = await fetch(`http://127.0.0.1:${port}/status`)
    expect(res.ok).toBe(true)
  })

  it('start() concurrently does not open two servers', async () => {
    const port = await freePort()
    relay = new Relay({ port })
    await Promise.all([relay.start(), relay.start()])
    expect(relay.running).toBe(true)
  })

  it('rejects with PortInUseError when the port is occupied', async () => {
    const port = await freePort()
    blocker = createServer()
    await new Promise<void>((r) => blocker!.listen(port, '127.0.0.1', () => r()))
    relay = new Relay({ port })
    const err = await relay.start().catch((e) => e)
    expect(err).toBeInstanceOf(PortInUseError)
    expect((err as PortInUseError).port).toBe(port)
    expect(relay.running).toBe(false)
  })

  it('can start again after a failed start', async () => {
    const port = await freePort()
    blocker = createServer()
    await new Promise<void>((r) => blocker!.listen(port, '127.0.0.1', () => r()))
    relay = new Relay({ port })
    await relay.start().catch(() => undefined)
    await new Promise<void>((r) => blocker!.close(() => r()))
    blocker = undefined
    await relay.start()
    expect(relay.running).toBe(true)
  })

  it('stop() ends the server, drops clients, and is idempotent', async () => {
    const { relay: r, port } = await startRelay()
    const c = await connect(port)
    await join(c, 'bye')
    await r.stop()
    expect(r.running).toBe(false)
    await until(() => c.ws.readyState === WebSocket.CLOSED)
    await r.stop()
    await expect(fetch(`http://127.0.0.1:${port}/status`)).rejects.toThrow()
  })

  it('writes log lines through the injected logger', async () => {
    const lines: string[] = []
    const port = await freePort()
    relay = new Relay({ port, log: (l) => lines.push(l) })
    await relay.start()
    const c = await connect(port)
    await join(c, 'logged')
    expect(lines.some((l) => l.includes('logged'))).toBe(true)
  })
})
