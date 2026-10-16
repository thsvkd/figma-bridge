import { win32 } from 'node:path'
import { aiDoctorMessages as m } from '../messages'
import type { DoctorResult } from './Doctor'

export interface AiDoctorDeps {
  findCommand: (name: 'claude' | 'codex') => string | null
  runProcess: (
    file: string,
    args: string[],
    // The prompt goes on stdin: it is multi-line and quoted, which neither cmd.exe nor argv survives.
    opts: { cwd: string; stdin: string },
  ) => Promise<{ code: number; stdout: string; stderr: string }>
  writeFile: (file: string, text: string) => Promise<void>
  /** Reads resources/ai-doctor.md. */
  readTemplate: () => Promise<string>
  /** Re-runs the deterministic doctor after the AI finished. */
  doctor: () => Promise<DoctorResult>
  exePath: string
  home: string
  logDir: string
  pluginUrl: string
  now?: () => Date
}

export interface AiDoctorResult {
  exitCode: number
  output: string
  bundlePath: string
  harness: 'Claude Code' | 'Codex'
  after: DoctorResult
}

// Masks bearer tokens, secret-looking JSON fields and sk- API keys, the same rules the PowerShell-era doctor used.
export function maskSecrets(text: string): string {
  if (!text) return text
  return text
    .replace(/(bearer\s+)[A-Za-z0-9\-_.=]+/gi, '$1***')
    .replace(/("(?:Authorization|api[_-]?key|token|secret)"\s*:\s*")[^"]+"/gi, '$1***"')
    .replace(/(sk-[A-Za-z0-9]{10,})/gi, 'sk-***')
}

export async function runAiDoctor(before: DoctorResult, deps: AiDoctorDeps): Promise<AiDoctorResult> {
  const claude = deps.findCommand('claude')
  const codex = claude ? null : deps.findCommand('codex')
  if (!claude && !codex) throw new Error(m.noTool)

  const now = (deps.now ?? (() => new Date()))()
  const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14)
  const bundlePath = win32.join(deps.logDir, `doctor-bundle-${stamp}.json`)
  const bundle = {
    when: now.toISOString(),
    mcpName: 'TalkToFigma',
    home: deps.home,
    exe: deps.exePath,
    pluginUrl: deps.pluginUrl,
    appliedFixes: before.applied,
    checks: before.checks,
    leftoverFail: before.checks.filter((c) => c.status === 'fail').map((c) => c.id),
  }
  await deps.writeFile(bundlePath, JSON.stringify(bundle, null, 2))

  let template: string
  try {
    template = await deps.readTemplate()
  } catch {
    template = m.fallbackPrompt
  }
  const prompt = template
    .replaceAll('{{BUNDLE}}', bundlePath)
    .replaceAll('{{EXE}}', deps.exePath)
    .replaceAll('{{HOME}}', deps.home)
    .replaceAll('{{PLUGIN}}', deps.pluginUrl)
  await deps.writeFile(win32.join(deps.logDir, `ai-doctor-prompt-${stamp}.md`), prompt)

  const tool = (claude ?? codex)!
  const toolArgs = claude
    ? ['-p', '--output-format', 'text', '--allowedTools', 'Bash', '--add-dir', deps.home]
    : ['exec', '--skip-git-repo-check', '-']
  // .cmd/.ps1 npm shims cannot be spawned directly (EINVAL since CVE-2024-27980); run the sibling .ps1.
  const shim = /\.(cmd|ps1)$/i.test(tool)
  const file = shim ? 'powershell.exe' : tool
  const args = shim
    ? ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tool.replace(/\.cmd$/i, '.ps1'), ...toolArgs]
    : toolArgs

  const r = await deps.runProcess(file, args, { cwd: deps.home, stdin: prompt })
  const output = maskSecrets(`${r.stdout}\r\n${r.stderr}`)
  await deps.writeFile(win32.join(deps.logDir, `ai-doctor-${stamp}.log`), output)
  return {
    exitCode: r.code,
    output,
    bundlePath,
    harness: claude ? 'Claude Code' : 'Codex',
    after: await deps.doctor(),
  }
}
