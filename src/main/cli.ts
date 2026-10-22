export type CliMode = 'gui' | 'mcp' | 'cleanup' | 'status' | 'doctor-fix'

export interface CliArgs {
  mode: CliMode
  hidden: boolean
}

// Highest priority first: if several are given, the first one listed here wins.
const MODE_FLAGS: ReadonlyArray<readonly [string, CliMode]> = [
  ['--cleanup', 'cleanup'],
  ['--status', 'status'],
  ['--doctor-fix', 'doctor-fix'],
]

// Unknown arguments are ignored: electron itself passes the app path and debug flags.
export function parseCliArgs(argv: string[]): CliArgs {
  // Old registrations passed the server script with ELECTRON_RUN_AS_NODE=1. Some
  // launchers omit that environment; still treat the invocation as MCP, never GUI.
  const legacyMcp = argv.some((arg) =>
    /[\\/]node_modules[\\/]cursor-talk-to-figma-mcp[\\/]dist[\\/]server\.js$/i.test(arg),
  )
  if (argv.includes('--mcp') || legacyMcp) return { mode: 'mcp', hidden: argv.includes('--hidden') }
  const mode = MODE_FLAGS.find(([flag]) => argv.includes(flag))?.[1] ?? 'gui'
  return { mode, hidden: argv.includes('--hidden') }
}
