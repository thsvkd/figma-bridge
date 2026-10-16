import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { HarnessId } from '@shared/types'
import { createPaths, type Paths } from '../paths'
import type { McpLaunch } from './launch'
import { createTargets, McpRegistry, type HarnessTarget } from './McpRegistry'

const HANGUL = /[\uAC00-\uD7A3]/

const launch: McpLaunch = {
  command: 'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\figma-bridge.exe',
  args: [
    'C:\\Users\\홍 길동\\AppData\\Local\\Programs\\figma-bridge\\resources\\app.asar.unpacked\\node_modules\\cursor-talk-to-figma-mcp\\dist\\server.js',
  ],
  env: { ELECTRON_RUN_AS_NODE: '1' },
}
const moved: McpLaunch = { ...launch, command: 'D:\\Apps\\figma-bridge\\figma-bridge.exe' }

let root: string
let paths: Paths
let cliCalls: Array<{ file: string; args: string[] }>
let cliResult: (args: string[]) => { code: number; stdout: string; stderr: string }
let commands: Record<'claude' | 'codex', string | null>

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'fb-mcp-'))
  paths = createPaths({ LOCALAPPDATA: join(root, 'L'), APPDATA: join(root, 'A'), USERPROFILE: join(root, 'U') })
  cliCalls = []
  cliResult = () => ({ code: 0, stdout: '', stderr: '' })
  commands = { claude: 'C:\\bin\\claude.exe', codex: 'C:\\bin\\codex.cmd' }
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

function targets(): HarnessTarget[] {
  return createTargets({
    paths,
    runCli: async (file, args) => {
      cliCalls.push({ file, args })
      return cliResult(args)
    },
    findCommand: (name) => commands[name],
  })
}
function target(id: HarnessId): HarnessTarget {
  const t = targets().find((x) => x.id === id)
  if (!t) throw new Error(`no target ${id}`)
  return t
}
function write(file: string, text: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, text)
}
function backups(): string[] {
  const dir = join(paths.home, 'backups')
  return existsSync(dir) ? readdirSync(dir) : []
}

// Fake target that remembers what it was registered with.
function fake(id: HarnessId, opts: { installed?: boolean; throws?: boolean } = {}) {
  let current: McpLaunch | null = null
  const t = {
    id,
    name: `name-${id}`,
    registerCalls: 0,
    unregisterCalls: 0,
    isInstalled: () => opts.installed ?? true,
    isRegistered: async (l: McpLaunch) => JSON.stringify(current) === JSON.stringify(l),
    register: async (l: McpLaunch) => {
      t.registerCalls++
      if (opts.throws) throw new Error('boom')
      current = l
    },
    unregister: async () => {
      t.unregisterCalls++
      if (opts.throws) throw new Error('boom')
      current = null
    },
  }
  return t
}

describe('McpRegistry', () => {
  it('does not register again when the same launch is already registered', async () => {
    const a = fake('claude')
    await a.register(launch)
    a.registerCalls = 0
    const res = await new McpRegistry([a]).ensure(launch)
    expect(res).toEqual([{ id: 'claude', changed: false }])
    expect(a.registerCalls).toBe(0)
  })

  it('is idempotent: a second ensure changes nothing', async () => {
    const reg = new McpRegistry([fake('claude'), fake('claude-desktop'), fake('codex')])
    expect((await reg.ensure(launch)).map((r) => r.changed)).toEqual([true, true, true])
    expect((await reg.ensure(launch)).map((r) => r.changed)).toEqual([false, false, false])
  })

  it('registers again when the app moved or was updated', async () => {
    const a = fake('codex')
    const reg = new McpRegistry([a])
    await reg.ensure(launch)
    expect(await reg.ensure(moved)).toEqual([{ id: 'codex', changed: true }])
    expect(a.registerCalls).toBe(2)
  })

  it('skips targets that are not installed', async () => {
    const missing = fake('codex', { installed: false })
    const res = await new McpRegistry([fake('claude'), missing]).ensure(launch)
    expect(res.map((r) => r.id)).toEqual(['claude'])
    expect(missing.registerCalls).toBe(0)
  })

  it('keeps going when one target throws and reports a Korean reason', async () => {
    const bad = fake('claude', { throws: true })
    const good = fake('codex')
    const res = await new McpRegistry([bad, good]).ensure(launch)
    expect(res[0].id).toBe('claude')
    expect(res[0].changed).toBe(false)
    expect(res[0].error).toMatch(HANGUL)
    expect(res[0].error).toContain('boom')
    expect(res[1]).toEqual({ id: 'codex', changed: true })
  })

  it('lists installed and registered state', async () => {
    const a = fake('claude')
    await a.register(launch)
    const list = await new McpRegistry([a, fake('codex', { installed: false })]).list(launch)
    expect(list).toEqual([
      { id: 'claude', name: 'name-claude', installed: true, registered: true },
      { id: 'codex', name: 'name-codex', installed: false, registered: false },
    ])
  })

  it('removeAll tries every target and then reports failures', async () => {
    const bad = fake('claude', { throws: true })
    const good = fake('codex')
    await expect(new McpRegistry([bad, good]).removeAll()).rejects.toThrow()
    expect(bad.unregisterCalls).toBe(1)
    expect(good.unregisterCalls).toBe(1)
  })
})

describe('createTargets', () => {
  it('returns Claude Code, Claude Desktop and Codex', () => {
    expect(targets().map((t) => t.id)).toEqual(['claude', 'claude-desktop', 'codex'])
  })
})

describe('Claude Desktop target', () => {
  const original = {
    globalShortcut: 'Ctrl+Space',
    mcpServers: { other: { command: 'npx', args: ['other-server'], env: { KEY: 'v' } } },
  }

  it('is installed only when the Claude config folder exists', () => {
    expect(target('claude-desktop').isInstalled()).toBe(false)
    mkdirSync(dirname(paths.claudeDesktopConfig), { recursive: true })
    expect(target('claude-desktop').isInstalled()).toBe(true)
  })

  it('adds only TalkToFigma and keeps other servers and top-level keys', async () => {
    write(paths.claudeDesktopConfig, JSON.stringify(original))
    await target('claude-desktop').register(launch)
    const after = JSON.parse(readFileSync(paths.claudeDesktopConfig, 'utf8'))
    expect(after).toEqual({
      globalShortcut: 'Ctrl+Space',
      mcpServers: {
        other: original.mcpServers.other,
        TalkToFigma: { command: launch.command, args: launch.args, env: launch.env },
      },
    })
    expect(await target('claude-desktop').isRegistered(launch)).toBe(true)
    expect(await target('claude-desktop').isRegistered(moved)).toBe(false)
  })

  it('backs up the previous file before writing', async () => {
    const text = JSON.stringify(original)
    write(paths.claudeDesktopConfig, text)
    await target('claude-desktop').register(launch)
    const files = backups()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^claude_desktop_config\.json\..+\.bak$/)
    expect(readFileSync(join(paths.home, 'backups', files[0]), 'utf8')).toBe(text)
  })

  it('creates the file when it does not exist', async () => {
    mkdirSync(dirname(paths.claudeDesktopConfig), { recursive: true })
    await target('claude-desktop').register(launch)
    expect(JSON.parse(readFileSync(paths.claudeDesktopConfig, 'utf8'))).toEqual({
      mcpServers: { TalkToFigma: { command: launch.command, args: launch.args, env: launch.env } },
    })
  })

  it('reads a file with a BOM', async () => {
    write(paths.claudeDesktopConfig, '\uFEFF' + JSON.stringify(original))
    await target('claude-desktop').register(launch)
    const raw = readFileSync(paths.claudeDesktopConfig, 'utf8')
    expect(raw.startsWith('\uFEFF')).toBe(false)
    const after = JSON.parse(raw)
    expect(after.globalShortcut).toBe('Ctrl+Space')
    expect(after.mcpServers.other).toEqual(original.mcpServers.other)
    expect(await target('claude-desktop').isRegistered(launch)).toBe(true)
  })

  it('treats an empty file as an empty config', async () => {
    write(paths.claudeDesktopConfig, '  \r\n')
    await target('claude-desktop').register(launch)
    expect(await target('claude-desktop').isRegistered(launch)).toBe(true)
  })

  it('does not touch a broken JSON file and throws a Korean error', async () => {
    const broken = '{ "mcpServers": { "other": '
    write(paths.claudeDesktopConfig, broken)
    const err = await target('claude-desktop').register(launch).then(() => null, (e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err?.message).toMatch(HANGUL)
    expect(readFileSync(paths.claudeDesktopConfig, 'utf8')).toBe(broken)

    const res = await new McpRegistry([target('claude-desktop')]).ensure(launch)
    expect(res[0].error).toMatch(HANGUL)
    expect(readFileSync(paths.claudeDesktopConfig, 'utf8')).toBe(broken)
  })

  it('refuses to overwrite a config whose mcpServers is not an object', async () => {
    const text = JSON.stringify({ mcpServers: ['x'] })
    write(paths.claudeDesktopConfig, text)
    await expect(target('claude-desktop').register(launch)).rejects.toThrow(HANGUL)
    expect(readFileSync(paths.claudeDesktopConfig, 'utf8')).toBe(text)
  })

  it('unregister removes only TalkToFigma', async () => {
    write(paths.claudeDesktopConfig, JSON.stringify(original))
    await target('claude-desktop').register(launch)
    await target('claude-desktop').unregister()
    expect(JSON.parse(readFileSync(paths.claudeDesktopConfig, 'utf8'))).toEqual(original)
  })

  it('unregister does nothing when the file is missing', async () => {
    await target('claude-desktop').unregister()
    expect(existsSync(paths.claudeDesktopConfig)).toBe(false)
  })
})

const BEGIN = '# >>> figma-bridge TalkToFigma >>>'
const END = '# <<< figma-bridge TalkToFigma <<<'

// Reads back the strings in our block. Our writer emits TOML basic strings, which are valid JSON strings.
function readCodexBlock(text: string): { command: string; args: string[]; env: string } {
  const block = text.slice(text.indexOf(BEGIN), text.indexOf(END))
  const command = JSON.parse(/^command = (".*")$/m.exec(block)![1]) as string
  const args = JSON.parse(/^args = (\[.*\])$/m.exec(block)![1]) as string[]
  const env = /^env = (.*)$/m.exec(block)![1]
  return { command, args, env }
}
function count(text: string, needle: string): number {
  return text.split(needle).length - 1
}

describe('Codex target', () => {
  const outside = 'model = "o3"\n\n[mcp_servers.other]\ncommand = "npx"\nargs = ["other"]\n'

  it('is installed only when the codex command is found', () => {
    expect(target('codex').isInstalled()).toBe(true)
    commands.codex = null
    expect(target('codex').isInstalled()).toBe(false)
  })

  it('writes a marker block with the launch and env and keeps the rest', async () => {
    write(paths.codexConfig, outside)
    await target('codex').register(launch)
    const text = readFileSync(paths.codexConfig, 'utf8')
    expect(text.startsWith(outside.trimEnd())).toBe(true)
    expect(text).toContain(`${BEGIN}\n[mcp_servers.TalkToFigma]\n`)
    expect(text).toContain('env = { ELECTRON_RUN_AS_NODE = "1" }')
    expect(readCodexBlock(text)).toEqual({
      command: launch.command,
      args: launch.args,
      env: '{ ELECTRON_RUN_AS_NODE = "1" }',
    })
    expect(await target('codex').isRegistered(launch)).toBe(true)
    expect(await target('codex').isRegistered(moved)).toBe(false)
  })

  it('creates the config when it does not exist', async () => {
    await target('codex').register(launch)
    expect(readCodexBlock(readFileSync(paths.codexConfig, 'utf8')).command).toBe(launch.command)
    expect(backups()).toHaveLength(0)
  })

  it('replaces its own block and keeps exactly one', async () => {
    write(paths.codexConfig, outside)
    await target('codex').register(launch)
    await target('codex').register(launch)
    await target('codex').register(moved)
    const text = readFileSync(paths.codexConfig, 'utf8')
    expect(count(text, BEGIN)).toBe(1)
    expect(count(text, '[mcp_servers.TalkToFigma]')).toBe(1)
    expect(readCodexBlock(text).command).toBe(moved.command)
    expect(text.startsWith(outside.trimEnd())).toBe(true)
  })

  it('keeps CRLF line endings and the content after the block', async () => {
    write(paths.codexConfig, 'a = 1\r\n')
    await target('codex').register(launch)
    write(paths.codexConfig, readFileSync(paths.codexConfig, 'utf8') + '\r\n[tail]\r\nb = 2\r\n')
    await target('codex').register(moved)
    const text = readFileSync(paths.codexConfig, 'utf8')
    expect(text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(text.startsWith('a = 1\r\n')).toBe(true)
    expect(text).toContain('[tail]\r\nb = 2\r\n')
    expect(count(text, BEGIN)).toBe(1)
  })

  it('replaces an unmarked TalkToFigma table instead of duplicating it', async () => {
    write(
      paths.codexConfig,
      'model = "o3"\n\n[mcp_servers.TalkToFigma]\ncommand = "bunx"\nargs = ["cursor-talk-to-figma-mcp@latest"]\n\n[mcp_servers.TalkToFigma.env]\nX = "1"\n\n[profiles.dev]\nmodel = "x"\n',
    )
    await target('codex').register(launch)
    const text = readFileSync(paths.codexConfig, 'utf8')
    expect(count(text, '[mcp_servers.TalkToFigma]')).toBe(1)
    expect(text).not.toContain('[mcp_servers.TalkToFigma.env]')
    expect(text).not.toContain('bunx')
    expect(text).toContain('model = "o3"')
    expect(text).toContain('[profiles.dev]\nmodel = "x"')
    expect(readCodexBlock(text).command).toBe(launch.command)
  })

  it('backs up the previous file before writing', async () => {
    write(paths.codexConfig, outside)
    await target('codex').register(launch)
    const files = backups()
    expect(files).toHaveLength(1)
    expect(files[0]).toMatch(/^config\.toml\..+\.bak$/)
    expect(readFileSync(join(paths.home, 'backups', files[0]), 'utf8')).toBe(outside)
  })

  it('escapes quotes and backslashes in paths', async () => {
    const odd: McpLaunch = { ...launch, command: 'C:\\Users\\O"Brien \'x\'\\a.exe' }
    await target('codex').register(odd)
    expect(readCodexBlock(readFileSync(paths.codexConfig, 'utf8')).command).toBe(odd.command)
    expect(await target('codex').isRegistered(odd)).toBe(true)
  })

  it('unregister removes only the marker block', async () => {
    write(paths.codexConfig, outside)
    await target('codex').register(launch)
    await target('codex').unregister()
    const text = readFileSync(paths.codexConfig, 'utf8')
    expect(text).not.toContain(BEGIN)
    expect(text).not.toContain('TalkToFigma')
    expect(text.trimEnd()).toBe(outside.trimEnd())
    expect(await target('codex').isRegistered(launch)).toBe(false)
  })

  it('unregister works even when codex is no longer installed', async () => {
    await target('codex').register(launch)
    commands.codex = null
    await target('codex').unregister()
    expect(readFileSync(paths.codexConfig, 'utf8')).not.toContain(BEGIN)
  })
})

describe('Claude Code target', () => {
  function writeClaudeJson(entry: unknown): void {
    write(paths.claudeJson, JSON.stringify({ numStartups: 3, mcpServers: { TalkToFigma: entry } }))
  }

  it('is installed only when the claude command is found', () => {
    expect(target('claude').isInstalled()).toBe(true)
    commands.claude = null
    expect(target('claude').isInstalled()).toBe(false)
  })

  it('isRegistered compares command, args and env from ~/.claude.json', async () => {
    expect(await target('claude').isRegistered(launch)).toBe(false)
    writeClaudeJson({ type: 'stdio', command: launch.command, args: launch.args, env: launch.env })
    expect(await target('claude').isRegistered(launch)).toBe(true)
    expect(await target('claude').isRegistered(moved)).toBe(false)
    writeClaudeJson({ type: 'stdio', command: launch.command, args: launch.args })
    expect(await target('claude').isRegistered(launch)).toBe(false)
  })

  it('isRegistered reads a file with a BOM and is false for broken JSON', async () => {
    write(
      paths.claudeJson,
      '\uFEFF' + JSON.stringify({ mcpServers: { TalkToFigma: { command: launch.command, args: launch.args, env: launch.env } } }),
    )
    expect(await target('claude').isRegistered(launch)).toBe(true)
    write(paths.claudeJson, '{ broken')
    expect(await target('claude').isRegistered(launch)).toBe(false)
  })

  it('register removes then adds with the CLI, passing arguments as an array', async () => {
    cliResult = (args) => (args[1] === 'remove' ? { code: 1, stdout: '', stderr: 'not found' } : { code: 0, stdout: '', stderr: '' })
    await target('claude').register(launch)
    expect(cliCalls).toEqual([
      { file: 'C:\\bin\\claude.exe', args: ['mcp', 'remove', 'TalkToFigma', '--scope', 'user'] },
      {
        file: 'C:\\bin\\claude.exe',
        args: [
          'mcp', 'add', '--scope', 'user', '--transport', 'stdio', 'TalkToFigma',
          '-e', 'ELECTRON_RUN_AS_NODE=1', '--', launch.command, ...launch.args,
        ],
      },
    ])
  })

  it('register throws a Korean error when the CLI add fails', async () => {
    cliResult = (args) => (args[1] === 'add' ? { code: 1, stdout: '', stderr: 'bad scope' } : { code: 0, stdout: '', stderr: '' })
    const err = await target('claude').register(launch).then(() => null, (e: Error) => e)
    expect(err?.message).toMatch(HANGUL)
    expect(err?.message).toContain('bad scope')
  })

  it('unregister calls the CLI only when an entry exists', async () => {
    await target('claude').unregister()
    expect(cliCalls).toEqual([])
    writeClaudeJson({ command: launch.command, args: launch.args, env: launch.env })
    await target('claude').unregister()
    expect(cliCalls).toEqual([{ file: 'C:\\bin\\claude.exe', args: ['mcp', 'remove', 'TalkToFigma', '--scope', 'user'] }])
  })

  it('unregister throws when the CLI fails to remove an existing entry', async () => {
    writeClaudeJson({ command: launch.command, args: launch.args, env: launch.env })
    cliResult = () => ({ code: 1, stdout: '', stderr: 'locked' })
    await expect(target('claude').unregister()).rejects.toThrow(HANGUL)
  })
})
