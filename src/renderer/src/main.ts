import type { BridgeState, DoctorReport, HarnessId, UpdateState } from '@shared/types'
import { appMessages as t } from '../../main/messages'
import './styles.css'
import { describeBridge } from './viewModel'

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id)
  if (!el) throw new Error(`Missing element #${id}`)
  return el as T
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

// ---- static labels ----
$('settings-title').textContent = t.settingsTitle
$('launch-at-login-label').textContent = t.launchAtLogin
$('launch-at-login-hint').textContent = t.launchAtLoginHint
$('update-check').textContent = t.updateCheck
$('tools-title').textContent = t.doctorTitle
$('doctor-run').textContent = t.doctorRun
$('doctor-fix').textContent = t.doctorFix
$('doctor-ai').textContent = t.doctorAi
$('install-title').textContent = t.installTitle

// ---- bridge state ----
let current: BridgeState | null = null

function renderBridge(state: BridgeState): void {
  current = state
  const view = describeBridge(state)
  $('status').dataset.tone = view.tone
  $('headline').textContent = view.headline
  $('detail').textContent = view.detail
  const action = $<HTMLButtonElement>('action')
  action.textContent = view.action.label
  action.disabled = state.busy
  const message = $('message')
  message.textContent = state.message ?? ''
  message.hidden = !state.message
  renderHarness(state)
}

function showMessage(text: string): void {
  const message = $('message')
  message.textContent = t.errorPrefix + text
  message.hidden = false
}

$('action').addEventListener('click', () => {
  if (!current) return
  const { kind } = describeBridge(current).action
  const call =
    kind === 'turn-on' ? window.bridge.turnOn : kind === 'turn-off' ? window.bridge.turnOff : window.bridge.attachPlugin
  call().then(renderBridge, (e) => showMessage(errorText(e)))
})

// ---- update ----
function updateText(s: UpdateState): string {
  switch (s.status) {
    case 'unsupported':
      return t.updateUnsupported
    case 'checking':
      return t.updateChecking
    case 'up-to-date':
      return t.updateUpToDate
    case 'available':
      return t.updateAvailable(s.version ?? '')
    case 'downloading':
      return t.updateDownloading(s.progress ?? 0)
    case 'ready':
      return t.updateReady
    case 'error':
      return t.updateError(s.error ?? '')
    case 'idle':
      return ''
  }
}

function renderUpdate(s: UpdateState): void {
  const text = updateText(s)
  const banner = s.status === 'available' || s.status === 'downloading' || s.status === 'ready'
  $('update').hidden = !banner
  $('update-text').textContent = banner ? text : ''
  const action = $<HTMLButtonElement>('update-action')
  action.hidden = s.status === 'downloading'
  action.textContent = s.status === 'ready' ? t.updateInstall : t.updateDownload
  action.dataset.status = s.status
  $('update-detail').textContent = banner ? '' : text
  const busy = ['unsupported', 'checking', 'downloading', 'ready'].includes(s.status)
  $<HTMLButtonElement>('update-check').disabled = busy
}

$('update-action').addEventListener('click', () => {
  const status = $('update-action').dataset.status
  if (status === 'ready') void window.bridge.update.install()
  else if (status === 'available') window.bridge.update.download().then(renderUpdate, () => undefined)
})
$('update-check').addEventListener('click', () => {
  window.bridge.update.check().then(renderUpdate, () => undefined)
})

// Notifications can be missed while the window is hidden, so re-read the state whenever the user looks.
const reloadUpdate = () => window.bridge.update.getState().then(renderUpdate, () => undefined)
$('settings').addEventListener('toggle', () => void reloadUpdate())
window.addEventListener('focus', () => void reloadUpdate())

// ---- settings ----
const launchBox = $<HTMLInputElement>('launch-at-login')
launchBox.addEventListener('change', () => {
  window.bridge.settings.set({ launchAtLogin: launchBox.checked }).then(
    (s) => (launchBox.checked = s.launchAtLogin),
    () => (launchBox.checked = !launchBox.checked),
  )
})

// ---- doctor and AI tools ----
const statusLabel = { ok: t.statusOk, warn: t.statusWarn, fail: t.statusFail }

function li(...children: Array<Node | string>): HTMLLIElement {
  const el = document.createElement('li')
  el.append(...children)
  return el
}

function badge(status: 'ok' | 'warn' | 'fail'): HTMLSpanElement {
  const b = document.createElement('span')
  b.className = 'badge'
  b.dataset.status = status
  b.textContent = statusLabel[status]
  return b
}

function renderDoctor(report: DoctorReport): void {
  const list = $('doctor-list')
  list.replaceChildren()
  if (report.checks.every((c) => c.status === 'ok')) list.append(li(t.doctorAllOk))
  for (const a of report.applied) list.append(li(a))
  for (const c of report.checks) {
    const hint = c.hint ? ` (${c.hint})` : ''
    list.append(li(badge(c.status), `${c.label}: ${c.text}${hint}`))
  }
}

async function runDoctor(button: HTMLButtonElement, job: () => Promise<void>): Promise<void> {
  const buttons = ['doctor-run', 'doctor-fix', 'doctor-ai'].map((id) => $<HTMLButtonElement>(id))
  buttons.forEach((b) => (b.disabled = true))
  const label = button.textContent
  button.textContent = button.id === 'doctor-ai' ? t.doctorAiRunning : t.doctorRunning
  try {
    await job()
  } catch (e) {
    $('doctor-list').replaceChildren(li(t.errorPrefix + errorText(e)))
  } finally {
    button.textContent = label
    buttons.forEach((b) => (b.disabled = false))
  }
}

for (const [id, fix] of [
  ['doctor-run', false],
  ['doctor-fix', true],
] as const) {
  const button = $<HTMLButtonElement>(id)
  button.addEventListener(
    'click',
    () => void runDoctor(button, async () => renderDoctor(await window.bridge.doctor.run(fix))),
  )
}

const aiButton = $<HTMLButtonElement>('doctor-ai')
aiButton.addEventListener(
  'click',
  () =>
    void runDoctor(aiButton, async () => {
      const r = await window.bridge.doctor.ai()
      renderDoctor(r.after)
      const out = $('doctor-ai-output')
      out.textContent = `${t.doctorAiDone(r.harness, r.exitCode)}\n\n${r.output}`
      out.hidden = false
    }),
)

function renderHarness(state: BridgeState): void {
  const list = $('harness-list')
  list.replaceChildren(
    ...state.harness.map((h) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = h.installed ? t.login : t.install
      button.addEventListener('click', () => void installOrLogin(h.id, h.installed, button))
      return li(badge(h.installed ? 'ok' : 'warn'), `${h.name} · ${h.installed ? t.installed : t.notInstalled}`, button)
    }),
  )
}

async function installOrLogin(id: HarnessId, installed: boolean, button: HTMLButtonElement): Promise<void> {
  const note = $('harness-note')
  const label = button.textContent
  button.disabled = true
  if (!installed) button.textContent = t.installing
  try {
    if (installed) {
      note.textContent = await window.bridge.harness.login(id)
    } else {
      const r = await window.bridge.harness.install(id)
      note.textContent = r.detail
      renderBridge(await window.bridge.getState())
    }
  } catch (e) {
    note.textContent = t.errorPrefix + errorText(e)
  } finally {
    note.hidden = false
    button.disabled = false
    if (installed) button.textContent = label
  }
}

// ---- boot ----
window.bridge.onState(renderBridge)
window.bridge.update.onState(renderUpdate)
void window.bridge.getState().then(renderBridge)
void reloadUpdate()
void window.bridge.settings.get().then((s) => (launchBox.checked = s.launchAtLogin))
