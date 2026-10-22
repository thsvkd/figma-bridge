// Runs only in the Node-mode child. Keep the bundled server's argv and stdio
// contract, and release its WebSocket/retry timers when the client closes stdin.
const { join } = require('node:path')
const { pathToFileURL } = require('node:url')

const server = join(__dirname, '..', 'node_modules', 'cursor-talk-to-figma-mcp', 'dist', 'server.js')
process.argv[1] = server
process.stdin.once('end', () => process.exit(0))
void import(pathToFileURL(server).href).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`, () => process.exit(1))
})
