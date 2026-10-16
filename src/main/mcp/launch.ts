import { win32 } from 'node:path'

export interface McpLaunch {
  command: string
  args: string[]
  env: Record<string, string>
}

// The app executable doubles as the Node runtime for the bundled MCP server.
export function buildLaunch(opts: { exePath: string; resourcesPath: string }): McpLaunch {
  const server = win32.join(
    opts.resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'cursor-talk-to-figma-mcp',
    'dist',
    'server.js',
  )
  return { command: opts.exePath, args: [server], env: { ELECTRON_RUN_AS_NODE: '1' } }
}
