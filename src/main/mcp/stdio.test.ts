import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, expect, it } from 'vitest'

// Exercise the real bundled server and stdin EOF, rather than a transport whose
// close() kills the server and would conceal an orphaned WebSocket retry loop.
function session() {
  const child = spawn(process.execPath, [resolve('resources/mcp-stdio.cjs')], {
    stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
  })
  let nextId = 0
  let stderr = ''
  const pending = new Map<number, (message: any) => void>()
  const lines = createInterface({ input: child.stdout })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  lines.on('line', (line) => {
    const message = JSON.parse(line)
    pending.get(message.id)?.(message)
    pending.delete(message.id)
  })
  const exited = once(child, 'exit')
  const request = (method: string, params: unknown = {}): Promise<any> => {
    const id = ++nextId
    return new Promise((done, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out: ${stderr}`)), 5000)
      pending.set(id, (message) => {
        clearTimeout(timer)
        if (message.error) reject(new Error(JSON.stringify(message.error)))
        else done(message.result)
      })
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
    })
  }
  return {
    child, request,
    async close() {
      child.stdin.end()
      const timer = setTimeout(() => child.kill(), 5000) // failed-test cleanup only
      try { expect((await exited)[0], stderr).toBe(0) }
      finally { clearTimeout(timer); lines.close() }
    },
  }
}

describe('MCP stdio bootstrap', () => {
  it('keeps two independent streams live and exits normally on each client EOF', async () => {
    const clients = [session(), session()]
    try {
      await Promise.all(clients.map(async (client) => {
        const initialized = await client.request('initialize', {
          protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'regression', version: '1' },
        })
        expect(initialized.serverInfo.name).toBe('TalkToFigmaMCP')
        const listed = await client.request('tools/list')
        expect(listed.tools.map((tool: { name: string }) => tool.name)).toEqual(
          expect.arrayContaining(['get_document_info', 'get_selection', 'join_channel']),
        )
        expect(await client.request('ping')).toEqual({})
        expect(client.child.exitCode).toBeNull()
      }))
      await clients[0].close()
      expect(await clients[1].request('ping')).toEqual({})
    } finally {
      await Promise.all(clients.filter((client) => client.child.exitCode === null).map((client) => client.close()))
    }
  }, 15_000)
})
