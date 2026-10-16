import { existsSync } from 'node:fs'
import * as nodeFs from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import type { HarnessId, HarnessState } from '@shared/types'
import { mcpMessages } from '../messages'
import type { Paths } from '../paths'
import type { McpLaunch } from './launch'

const MCP_NAME = 'TalkToFigma'
const BEGIN = '# >>> figma-bridge TalkToFigma >>>'
const END = '# <<< figma-bridge TalkToFigma <<<'

type Fs = typeof import('node:fs/promises')
type CliResult = { code: number; stdout: string; stderr: string }

export interface HarnessTarget {
  id: HarnessId
  name: string
  isInstalled(): boolean
  isRegistered(l: McpLaunch): Promise<boolean>
  register(l: McpLaunch): Promise<void>
  unregister(): Promise<void>
}

export interface TargetDeps {
  paths: Paths
  runCli: (file: string, args: string[]) => Promise<CliResult>
  findCommand: (name: 'claude' | 'codex') => string | null
  fs?: Fs
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function sameLaunch(entry: unknown, l: McpLaunch): boolean {
  if (!isObject(entry)) return false
  return isDeepStrictEqual(
    { command: entry.command, args: entry.args, env: entry.env },
    { command: l.command, args: l.args, env: l.env },
  )
}

// File helpers: every write is read-modify-write, backed up first, and atomic (tmp + rename).
function fileOps(fs: Fs, backupDir: string) {
  async function readText(file: string): Promise<string | null> {
    try {
      return (await fs.readFile(file, 'utf8')).replace(/^﻿/, '')
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw e
    }
  }

  // Returns null when the file is missing; throws (without writing anything) when it cannot be trusted.
  async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
    const text = await readText(file)
    if (text === null) return null
    if (!text.trim()) return {}
    let data: unknown
    try {
      data = JSON.parse(text)
    } catch {
      throw new Error(mcpMessages.brokenJson(file))
    }
    if (!isObject(data)) throw new Error(mcpMessages.unexpectedJson(file))
    return data
  }

  async function backup(file: string): Promise<void> {
    await fs.mkdir(backupDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[-:.]/g, '')
    for (let n = 0; ; n++) {
      const dest = join(backupDir, `${basename(file)}.${stamp}${n ? `-${n}` : ''}.bak`)
      try {
        await fs.copyFile(file, dest, nodeFs.constants.COPYFILE_EXCL)
        return
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e
      }
    }
  }

  async function writeText(file: string, text: string, existed: boolean): Promise<void> {
    if (existed) await backup(file)
    await fs.mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.tmp`
    await fs.writeFile(tmp, text, 'utf8')
    await fs.rename(tmp, file)
  }

  return { readText, readJsonObject, writeText }
}

// --- Codex TOML -------------------------------------------------------------

// TOML basic strings accept JSON string escapes, so JSON.stringify quotes paths safely.
function codexBlock(l: McpLaunch, eol: string): string {
  const env = Object.entries(l.env)
    .map(([k, v]) => `${k} = ${JSON.stringify(v)}`)
    .join(', ')
  return [
    BEGIN,
    `[mcp_servers.${MCP_NAME}]`,
    `command = ${JSON.stringify(l.command)}`,
    `args = ${JSON.stringify(l.args)}`,
    `env = { ${env} }`,
    END,
  ].join(eol)
}

// Splits around our marker block; block is null when the file has none.
function splitBlock(text: string): { before: string; block: string | null; after: string } {
  const start = text.indexOf(BEGIN)
  const end = start < 0 ? -1 : text.indexOf(END, start)
  if (end < 0) return { before: text, block: null, after: '' }
  return {
    before: text.slice(0, start),
    block: text.slice(start, end + END.length),
    after: text.slice(end + END.length),
  }
}

const OWN_TABLE = /^\s*\[\s*mcp_servers\s*\.\s*(?:TalkToFigma|"TalkToFigma"|'TalkToFigma')\s*[.\]]/
const ANY_TABLE = /^\s*\[/

// Drops TalkToFigma tables written outside our markers (e.g. by `codex mcp add`), so the
// file never ends up with the table defined twice.
function removeUnmarked(text: string): string {
  const lines = text.split(/(?<=\n)/)
  let skipping = false
  return lines
    .filter((line) => {
      if (OWN_TABLE.test(line)) skipping = true
      else if (ANY_TABLE.test(line)) skipping = false
      return !skipping
    })
    .join('')
}

function hasUnmarked(text: string): boolean {
  const { before, after } = splitBlock(text)
  return removeUnmarked(before) !== before || removeUnmarked(after) !== after
}

function codexTarget(deps: TargetDeps, ops: ReturnType<typeof fileOps>): HarnessTarget {
  const file = deps.paths.codexConfig
  return {
    id: 'codex',
    name: mcpMessages.harnessName.codex,
    isInstalled: () => deps.findCommand('codex') !== null,
    async isRegistered(l) {
      const text = await ops.readText(file)
      if (text === null) return false
      const { block } = splitBlock(text)
      if (block === null || hasUnmarked(text)) return false
      return block.replace(/\r\n/g, '\n') === codexBlock(l, '\n')
    },
    async register(l) {
      const text = await ops.readText(file)
      const current = text ?? ''
      const eol = current.includes('\r\n') ? '\r\n' : '\n'
      const block = codexBlock(l, eol)
      const parts = splitBlock(current)
      let next: string
      if (parts.block !== null) {
        next = removeUnmarked(parts.before) + block + removeUnmarked(parts.after)
      } else {
        const head = removeUnmarked(current).trimEnd()
        next = (head ? head + eol + eol : '') + block + eol
      }
      await ops.writeText(file, next, text !== null)
    },
    async unregister() {
      const original = await ops.readText(file)
      if (original === null) return
      // Older builds registered through `codex mcp add`, which leaves an unmarked table. Let the CLI try
      // first; whatever it leaves behind is removed from the file below.
      const cli = deps.findCommand('codex')
      if (cli && hasUnmarked(original)) {
        try {
          await deps.runCli(cli, ['mcp', 'remove', MCP_NAME])
        } catch {
          // Best effort: the file cleanup below does not depend on it.
        }
      }
      const text = cli ? await ops.readText(file) : original
      if (text === null) return
      const { before, block, after } = splitBlock(text)
      let next: string
      if (block === null) {
        next = removeUnmarked(text)
      } else {
        const eol = text.includes('\r\n') ? '\r\n' : '\n'
        const rest = [removeUnmarked(before).trimEnd(), removeUnmarked(after).replace(/^(?:\r?\n)+/, '')].filter((s) =>
          s.trim(),
        )
        next = rest.join(eol + eol)
        if (next && !next.endsWith('\n')) next += eol
      }
      if (next !== text) await ops.writeText(file, next, true)
    },
  }
}

// --- Claude Desktop JSON ----------------------------------------------------

function claudeDesktopTarget(deps: TargetDeps, ops: ReturnType<typeof fileOps>): HarnessTarget {
  const file = deps.paths.claudeDesktopConfig

  async function load(): Promise<{ data: Record<string, unknown>; servers: Record<string, unknown>; existed: boolean }> {
    const loaded = await ops.readJsonObject(file)
    const data = loaded ?? {}
    const servers = data.mcpServers ?? {}
    if (!isObject(servers)) throw new Error(mcpMessages.unexpectedJson(file))
    return { data, servers, existed: loaded !== null }
  }

  return {
    id: 'claude-desktop',
    name: mcpMessages.harnessName['claude-desktop'],
    isInstalled: () => existsSync(dirname(file)),
    async isRegistered(l) {
      const { servers } = await load()
      return sameLaunch(servers[MCP_NAME], l)
    },
    async register(l) {
      const { data, servers, existed } = await load()
      servers[MCP_NAME] = { command: l.command, args: [...l.args], env: { ...l.env } }
      data.mcpServers = servers
      await ops.writeText(file, JSON.stringify(data, null, 2) + '\n', existed)
    },
    async unregister() {
      const { data, servers, existed } = await load()
      if (!existed || !(MCP_NAME in servers)) return
      delete servers[MCP_NAME]
      await ops.writeText(file, JSON.stringify(data, null, 2) + '\n', true)
    },
  }
}

// --- Claude Code CLI --------------------------------------------------------

function claudeCodeTarget(deps: TargetDeps, ops: ReturnType<typeof fileOps>): HarnessTarget {
  const name = mcpMessages.harnessName.claude
  const removeArgs = ['mcp', 'remove', MCP_NAME, '--scope', 'user']

  // Claude Code owns ~/.claude.json; we only read it and change it through the CLI.
  async function entry(): Promise<unknown> {
    const data = await ops.readJsonObject(deps.paths.claudeJson)
    const servers = data?.mcpServers
    return isObject(servers) ? servers[MCP_NAME] : undefined
  }

  return {
    id: 'claude',
    name,
    isInstalled: () => deps.findCommand('claude') !== null,
    async isRegistered(l) {
      try {
        return sameLaunch(await entry(), l)
      } catch {
        return false
      }
    },
    async register(l) {
      const cli = deps.findCommand('claude')
      if (!cli) throw new Error(mcpMessages.cliMissing(name))
      try {
        await deps.runCli(cli, removeArgs)
      } catch {
        // Removing a missing entry fails; that is expected.
      }
      // The name goes before -e: -e is variadic and would swallow it otherwise.
      const env = Object.entries(l.env).flatMap(([k, v]) => ['-e', `${k}=${v}`])
      const r = await deps.runCli(cli, [
        'mcp', 'add', '--scope', 'user', '--transport', 'stdio', MCP_NAME, ...env, '--', l.command, ...l.args,
      ])
      if (r.code !== 0) throw new Error(mcpMessages.cliFailed(name, (r.stderr + r.stdout).trim()))
    },
    async unregister() {
      const cli = deps.findCommand('claude')
      if (!cli) return
      let present = true
      try {
        present = (await entry()) !== undefined
      } catch {
        // Unreadable file: let the CLI decide.
      }
      if (!present) return
      const r = await deps.runCli(cli, removeArgs)
      if (r.code !== 0) throw new Error(mcpMessages.cliFailed(name, (r.stderr + r.stdout).trim()))
    },
  }
}

export function createTargets(deps: TargetDeps): HarnessTarget[] {
  const ops = fileOps(deps.fs ?? nodeFs, join(deps.paths.home, 'backups'))
  return [claudeCodeTarget(deps, ops), claudeDesktopTarget(deps, ops), codexTarget(deps, ops)]
}

export class McpRegistry {
  constructor(private readonly targets: HarnessTarget[]) {}

  // Registers on every installed target whose entry is missing or points elsewhere.
  async ensure(l: McpLaunch): Promise<Array<{ id: HarnessId; changed: boolean; error?: string }>> {
    const results: Array<{ id: HarnessId; changed: boolean; error?: string }> = []
    for (const t of this.targets) {
      if (!t.isInstalled()) continue
      try {
        if (await t.isRegistered(l)) {
          results.push({ id: t.id, changed: false })
        } else {
          await t.register(l)
          results.push({ id: t.id, changed: true })
        }
      } catch (e) {
        results.push({ id: t.id, changed: false, error: mcpMessages.registerFailed(t.name, errorText(e)) })
      }
    }
    return results
  }

  // Uninstall cleanup: tries every target, then reports what failed.
  async removeAll(): Promise<void> {
    const failures: string[] = []
    for (const t of this.targets) {
      try {
        await t.unregister()
      } catch (e) {
        failures.push(`${t.name}: ${errorText(e)}`)
      }
    }
    if (failures.length) throw new Error(mcpMessages.removeFailed(failures.join('; ')))
  }

  async list(l: McpLaunch): Promise<HarnessState[]> {
    const out: HarnessState[] = []
    for (const t of this.targets) {
      const installed = t.isInstalled()
      let registered = false
      if (installed) {
        try {
          registered = await t.isRegistered(l)
        } catch {
          registered = false
        }
      }
      out.push({ id: t.id, name: t.name, installed, registered })
    }
    return out
  }
}
