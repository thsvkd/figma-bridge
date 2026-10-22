export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

// Mode selection must survive clients that do not forward the registered env.
export function buildLaunch(opts: { exePath: string }): McpLaunch {
  return { command: opts.exePath, args: ['--mcp'], env: {} }
}
