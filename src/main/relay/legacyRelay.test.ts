import { describe, expect, it } from 'vitest'
import { PortInUseError } from './Relay'
import { listeningPids, startWithLegacyCleanup, stopLegacyRelay, type LegacyRelayDeps } from './legacyRelay'

function setup(
  o: {
    status?: { relay?: unknown } | null
    pidFile?: string | null
    image?: string | null
    listeners?: number[]
    currentPid?: number
  } = {},
) {
  const killed: number[] = []
  const pidFiles: string[] = []
  let alive = true
  const deps: LegacyRelayDeps = {
    port: 3055,
    home: 'C:\\Users\\u\\AppData\\Local\\FigmaBridge',
    fetchStatus: async () => (alive ? (o.status === undefined ? { relay: 'figma-bridge' } : o.status) : null),
    readPidFile: async (file) => {
      pidFiles.push(file)
      return o.pidFile === undefined ? '4242\r\n' : o.pidFile
    },
    imageNameOf: async () => (o.image === undefined ? 'bun.exe' : o.image),
    listenerPids: async () => o.listeners ?? [4242],
    kill: async (pid) => {
      killed.push(pid)
      alive = false
    },
    currentPid: o.currentPid ?? 1000,
    sleep: async () => undefined,
  }
  return { deps, killed, pidFiles }
}

describe('stopLegacyRelay', () => {
  it('kills an identified legacy relay', async () => {
    const t = setup()
    expect(await stopLegacyRelay(t.deps)).toBe(true)
    expect(t.killed).toEqual([4242])
    expect(t.pidFiles).toEqual(['C:\\Users\\u\\AppData\\Local\\FigmaBridge\\socket.pid'])
  })

  it('accepts node.exe in any case', async () => {
    const t = setup({ image: 'NODE.EXE' })
    expect(await stopLegacyRelay(t.deps)).toBe(true)
    expect(t.killed).toEqual([4242])
  })

  it('does not kill when the port is not our relay', async () => {
    const t = setup({ status: { relay: 'something-else' } })
    expect(await stopLegacyRelay(t.deps)).toBe(false)
    expect(t.killed).toEqual([])
  })

  it('does not kill when nothing answers /status', async () => {
    const t = setup({ status: null })
    expect(await stopLegacyRelay(t.deps)).toBe(false)
    expect(t.killed).toEqual([])
  })

  it('does not kill when the pid file is missing or not a number', async () => {
    for (const pidFile of [null, '', 'abc']) {
      const t = setup({ pidFile })
      expect(await stopLegacyRelay(t.deps)).toBe(false)
      expect(t.killed).toEqual([])
    }
  })

  it('does not kill itself', async () => {
    const t = setup({ currentPid: 4242 })
    expect(await stopLegacyRelay(t.deps)).toBe(false)
    expect(t.killed).toEqual([])
  })

  it('does not kill a process that is neither bun nor node', async () => {
    for (const image of ['figma-bridge.exe', 'explorer.exe', null]) {
      const t = setup({ image })
      expect(await stopLegacyRelay(t.deps)).toBe(false)
      expect(t.killed).toEqual([])
    }
  })

  it('does not kill a stale pid that is a live node.exe but does not own the port', async () => {
    const t = setup({ image: 'node.exe', listeners: [9999] })
    expect(await stopLegacyRelay(t.deps)).toBe(false)
    expect(t.killed).toEqual([])
  })

  it('does not kill when nothing is listening on the port', async () => {
    const t = setup({ listeners: [] })
    expect(await stopLegacyRelay(t.deps)).toBe(false)
    expect(t.killed).toEqual([])
  })
})

describe('listeningPids', () => {
  const out = [
    '',
    '활성 연결',
    '',
    '  프로토콜  로컬 주소              외부 주소              상태            PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1444',
    '  TCP    127.0.0.1:3055         0.0.0.0:0              LISTENING       4242',
    '  TCP    127.0.0.1:3055         127.0.0.1:51000        ESTABLISHED     4242',
    '  TCP    127.0.0.1:51000        127.0.0.1:3055         ESTABLISHED     7777',
    '  TCP    0.0.0.0:30550          0.0.0.0:0              LISTENING       8888',
    '  TCP    [::]:3055              [::]:0                 ABHÖREN         5555',
  ].join('\r\n')

  it('returns only the listeners of that exact port, whatever the locale', () => {
    expect(listeningPids(out, 3055)).toEqual([4242, 5555])
  })

  it('returns nothing when the port is free', () => {
    expect(listeningPids(out, 4000)).toEqual([])
  })
})

describe('startWithLegacyCleanup', () => {
  it('retries once after a legacy relay was stopped', async () => {
    let calls = 0
    const start = async () => {
      if (++calls === 1) throw new PortInUseError(3055)
    }
    await startWithLegacyCleanup(start, async () => true)
    expect(calls).toBe(2)
  })

  it('rethrows the original error when no legacy relay was stopped', async () => {
    const err = new PortInUseError(3055)
    let calls = 0
    const start = async () => {
      calls++
      throw err
    }
    await expect(startWithLegacyCleanup(start, async () => false)).rejects.toBe(err)
    expect(calls).toBe(1)
  })

  it('does not look for a legacy relay on other errors', async () => {
    let looked = false
    const start = async () => {
      throw new Error('EACCES')
    }
    await expect(
      startWithLegacyCleanup(start, async () => {
        looked = true
        return true
      }),
    ).rejects.toThrow('EACCES')
    expect(looked).toBe(false)
  })
})
