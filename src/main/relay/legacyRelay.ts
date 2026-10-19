import { win32 } from 'node:path'
import { PortInUseError } from './Relay'

// The PowerShell-era app ran its relay as a separate bun/node process and wrote that process's PID to
// <home>\socket.pid. After an upgrade that process can still hold the port, so the new relay cannot start.

export interface LegacyRelayDeps {
  port: number
  home: string
  /** GET /status on the port, parsed; null when nothing answers. */
  fetchStatus: (port: number) => Promise<{ relay?: unknown } | null>
  /** File contents, null when the file is missing. */
  readPidFile: (file: string) => Promise<string | null>
  /** Executable name of a running process (e.g. "bun.exe"), null when it is not running. */
  imageNameOf: (pid: number) => Promise<string | null>
  /** PIDs of the processes listening on the port (see listeningPids). */
  listenerPids: (port: number) => Promise<number[]>
  kill: (pid: number) => Promise<void>
  currentPid: number
  sleep: (ms: number) => Promise<void>
}

const LEGACY_IMAGES = ['bun.exe', 'node.exe']

/** Stops the old relay only when it is positively identified; returns true when it was stopped. */
export async function stopLegacyRelay(deps: LegacyRelayDeps): Promise<boolean> {
  const status = await deps.fetchStatus(deps.port)
  if (status?.relay !== 'figma-bridge') return false
  const raw = (await deps.readPidFile(win32.join(deps.home, 'socket.pid')))?.trim() ?? ''
  if (!/^\d+$/.test(raw)) return false
  const pid = Number(raw)
  if (pid === deps.currentPid) return false
  const image = (await deps.imageNameOf(pid))?.toLowerCase()
  if (!image || !LEGACY_IMAGES.includes(image)) return false
  // socket.pid survives crashes and reboots, so its PID may now belong to an unrelated bun/node process.
  if (!(await deps.listenerPids(deps.port)).includes(pid)) return false
  await deps.kill(pid)
  // Wait until the port stops answering so the caller's retry can bind it.
  for (let i = 0; i < 20 && (await deps.fetchStatus(deps.port)); i++) await deps.sleep(250)
  return true
}

/**
 * PIDs listening on a TCP port, parsed from `netstat -ano -p TCP` output. A listening row has a remote
 * address ending in ":0"; that is matched instead of the state word, which some Windows locales translate.
 */
export function listeningPids(netstatOut: string, port: number): number[] {
  const pids: number[] = []
  for (const line of netstatOut.split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/)
    if (cols[0] !== 'TCP' || !cols[1]?.endsWith(`:${port}`) || !cols[2]?.endsWith(':0')) continue
    const pid = Number(cols[cols.length - 1])
    if (Number.isInteger(pid) && pid > 0) pids.push(pid)
  }
  return pids
}

/** Starts the relay; on a busy port, stops a legacy relay and retries once, else rethrows the original error. */
export async function startWithLegacyCleanup(
  start: () => Promise<void>,
  stopLegacy: () => Promise<boolean>,
): Promise<void> {
  try {
    await start()
  } catch (e) {
    if (!(e instanceof PortInUseError) || !(await stopLegacy())) throw e
    await start()
  }
}
