import { createServer, type IncomingMessage, type Server } from 'node:http'
import { WebSocket, WebSocketServer } from 'ws'

// Port of lib/relay.js: same join / message / progress_update protocol, channel bridging and GET /status.

export interface RelayStatus {
  relay: 'figma-bridge'
  ok: true
  port: number
  startedAt: string
  figma: number
  harness: number
  figmaJoined: number
  harnessJoined: number
  ready: boolean
  channels: string[]
}

export class PortInUseError extends Error {
  constructor(public port: number) {
    super(`Port ${port} is already in use`)
    this.name = 'PortInUseError'
  }
}

interface ClientMeta {
  kind: 'figma' | 'harness'
  channel: string | null
}

const CORS = { 'Access-Control-Allow-Origin': '*' }

// A Figma plugin UI is a browser context, so it sends an Origin (usually "null").
// The MCP server's node ws client sends neither Origin nor a browser User-Agent.
function clientKind(req: IncomingMessage): ClientMeta['kind'] {
  const ua = req.headers['user-agent'] ?? ''
  return req.headers.origin !== undefined || /figma|electron|mozilla/i.test(ua) ? 'figma' : 'harness'
}

export class Relay {
  private readonly port: number
  private readonly log: (line: string) => void
  private server: Server | null = null
  private wss: WebSocketServer | null = null
  private starting: Promise<void> | null = null
  private startedAt = ''
  private readonly clients = new Map<WebSocket, ClientMeta>()

  constructor(opts: { port: number; log?: (line: string) => void }) {
    this.port = opts.port
    this.log = opts.log ?? (() => undefined)
  }

  get running(): boolean {
    return this.server !== null
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve()
    this.starting ??= this.listen().finally(() => {
      this.starting = null
    })
    return this.starting
  }

  private listen(): Promise<void> {
    const server = createServer((req, res) => {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          ...CORS,
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        })
        res.end()
      } else if (new URL(req.url ?? '/', 'http://localhost').pathname === '/status') {
        res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' })
        res.end(JSON.stringify(this.status()))
      } else {
        // Same body as the original socket server; health checks look for this string.
        res.writeHead(200, { ...CORS, 'Content-Type': 'text/plain' })
        res.end('WebSocket server running')
      }
    })
    const wss = new WebSocketServer({ server })
    // ws re-emits the http server's errors (e.g. EADDRINUSE); listen() below reports them via the start() promise.
    wss.on('error', () => undefined)
    wss.on('connection', (ws, req) => this.onConnection(ws, req))

    return new Promise<void>((resolve, reject) => {
      server.once('error', (err: NodeJS.ErrnoException) => {
        wss.close()
        reject(err.code === 'EADDRINUSE' ? new PortInUseError(this.port) : err)
      })
      server.listen(this.port, '127.0.0.1', () => {
        this.server = server
        this.wss = wss
        this.startedAt = new Date().toISOString()
        this.log(`WebSocket server running on port ${this.port}`)
        resolve()
      })
    })
  }

  async stop(): Promise<void> {
    const { server, wss } = this
    if (!server || !wss) return
    this.server = null
    this.wss = null
    for (const ws of this.clients.keys()) ws.terminate()
    this.clients.clear()
    await new Promise<void>((resolve) => wss.close(() => resolve()))
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
      server.closeAllConnections()
    })
  }

  status(): RelayStatus {
    const channels = new Set<string>()
    let figma = 0
    let harness = 0
    let figmaJoined = 0
    let harnessJoined = 0
    for (const meta of this.clients.values()) {
      if (meta.channel) channels.add(meta.channel)
      if (meta.kind === 'figma') {
        figma++
        if (meta.channel) figmaJoined++
      } else {
        harness++
        if (meta.channel) harnessJoined++
      }
    }
    return {
      relay: 'figma-bridge',
      ok: true,
      port: this.port,
      startedAt: this.startedAt,
      figma,
      harness,
      figmaJoined,
      harnessJoined,
      ready: figmaJoined > 0 && harnessJoined > 0,
      channels: [...channels],
    }
  }

  private send(ws: WebSocket, obj: unknown): void {
    try {
      ws.send(JSON.stringify(obj))
    } catch (err) {
      this.log(`send failed: ${err}`)
    }
  }

  private joinedPeers(exclude: WebSocket | null): [WebSocket, ClientMeta][] {
    const out: [WebSocket, ClientMeta][] = []
    for (const [ws, meta] of this.clients) {
      if (ws !== exclude && meta.channel && ws.readyState === WebSocket.OPEN) out.push([ws, meta])
    }
    return out
  }

  private onConnection(ws: WebSocket, req: IncomingMessage): void {
    const meta: ClientMeta = { kind: clientKind(req), channel: null }
    this.clients.set(ws, meta)
    this.log(`New client connected (${meta.kind}, total ${this.clients.size})`)
    this.send(ws, { type: 'system', message: 'Please join a channel to start chatting' })

    ws.on('message', (raw) => this.onMessage(ws, meta, raw.toString()))
    ws.on('error', (err) => this.log(`socket error: ${err}`))
    ws.on('close', () => {
      if (!this.clients.delete(ws)) return
      this.log(`Client disconnected (${meta.kind}, total ${this.clients.size})`)
      for (const [peer, peerMeta] of this.joinedPeers(null)) {
        this.send(peer, { type: 'system', message: 'A user has left the channel', channel: peerMeta.channel })
      }
    })
  }

  private onMessage(ws: WebSocket, meta: ClientMeta, raw: string): void {
    let data: any
    try {
      data = JSON.parse(raw)
    } catch (err) {
      this.log(`Error parsing message: ${err}`)
      return
    }
    if (data === null || typeof data !== 'object') return

    if (data.type === 'join') {
      const channel = data.channel
      if (!channel || typeof channel !== 'string') {
        this.send(ws, { type: 'error', message: 'Channel name is required' })
        return
      }
      meta.channel = channel
      this.log(`Client joined channel "${channel}" (${meta.kind})`)
      this.send(ws, { type: 'system', message: `Joined channel: ${channel}`, channel })
      this.send(ws, {
        type: 'system',
        message: { id: data.id, result: `Connected to channel: ${channel}` },
        channel,
      })
      for (const [peer, peerMeta] of this.joinedPeers(ws)) {
        this.send(peer, {
          type: 'system',
          message: 'A new user has joined the channel',
          channel: peerMeta.channel,
        })
      }
      return
    }

    if (data.type === 'message') {
      if (!meta.channel) {
        this.send(ws, { type: 'error', message: 'You must join the channel first' })
        return
      }
      const peers = this.joinedPeers(ws)
      for (const [peer, peerMeta] of peers) {
        // Swap in the receiver's own channel name so each side sees its own channel.
        this.send(peer, { type: 'broadcast', message: data.message, sender: 'peer', channel: peerMeta.channel })
      }
      if (peers.length === 0) this.log(`No peer to receive message from "${meta.channel}"`)
      return
    }

    if (data.type === 'progress_update' && meta.channel) {
      for (const [peer, peerMeta] of this.joinedPeers(ws)) {
        this.send(peer, { ...data, channel: peerMeta.channel })
      }
    }
  }
}
