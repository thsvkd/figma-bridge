export type CliMode = 'gui' | 'cleanup' | 'status' | 'doctor-fix'

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
  const mode = MODE_FLAGS.find(([flag]) => argv.includes(flag))?.[1] ?? 'gui'
  return { mode, hidden: argv.includes('--hidden') }
}
