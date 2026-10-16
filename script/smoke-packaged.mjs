// Runs the unpacked Windows build with `--status` and checks that it prints the status JSON.
import { spawn } from 'node:child_process'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const TIMEOUT_MS = 30_000

export function isPackagedExecutable(filePath) {
  return /\/win(?:-[^/]+)?-unpacked\/figma-bridge\.exe$/i.test(filePath.replaceAll(path.sep, '/'))
}

// Electron may print logging lines around the JSON, so take the outermost braces.
export function extractStatusJson(output) {
  const start = output.indexOf('{')
  const end = output.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error(`No JSON object in output: ${output.slice(0, 200)}`)
  return JSON.parse(output.slice(start, end + 1))
}

async function collectFiles(directory) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) files.push(...(await collectFiles(entryPath)))
    else if (entry.isFile()) files.push(entryPath)
  }
  return files
}

function runStatus(executable, home) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, ['--status'], {
      env: { ...process.env, FIGMA_BRIDGE_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    const timer = setTimeout(() => {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      reject(new Error(`--status did not finish within ${TIMEOUT_MS}ms`))
    }, TIMEOUT_MS)
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolve(stdout)
      else reject(new Error(`--status exited with code ${code}: ${stderr || stdout}`))
    })
  })
}

async function main() {
  const candidates = (await collectFiles(path.resolve('dist'))).filter(isPackagedExecutable)
  if (candidates.length !== 1) {
    throw new Error(`Expected one packaged executable, found ${candidates.length}: ${candidates.join(', ')}`)
  }
  const home = await mkdtemp(path.join(tmpdir(), 'figma-bridge-smoke-'))
  try {
    console.log(`[smoke] launching ${candidates[0]} --status`)
    const status = extractStatusJson(await runStatus(candidates[0], home))
    for (const key of ['version', 'switchOn', 'relay', 'figmaInstalled', 'figmaRunning', 'harness']) {
      if (!(key in status)) throw new Error(`Status JSON is missing "${key}"`)
    }
    console.log(`[smoke] packaged app passed (version ${status.version})`)
  } finally {
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(`[smoke] packaged app failed: ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
