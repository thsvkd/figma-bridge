import { describe, expect, it } from 'vitest'
import type { BridgeState } from '@shared/types'
import { describeBridge } from './viewModel'

const base: BridgeState = {
  switchOn: false,
  status: 'off',
  busy: false,
  figmaInstalled: true,
  figmaRunning: true,
  harness: [],
}
const state = (patch: Partial<BridgeState>): BridgeState => ({ ...base, ...patch })

describe('describeBridge', () => {
  it('off: neutral tone and a turn-on action labelled 연동', () => {
    const v = describeBridge(state({}))
    expect(v.tone).toBe('off')
    expect(v.action).toEqual({ kind: 'turn-on', label: '연동' })
    expect(v.headline).not.toBe('')
  })

  it('relay-only: warn tone, says it is not connected yet, offers plugin attach', () => {
    const v = describeBridge(state({ switchOn: true, status: 'relay-only' }))
    expect(v.tone).toBe('warn')
    expect(v.headline).toContain('아직 연결되지 않았습니다')
    expect(v.action).toEqual({ kind: 'attach-plugin', label: '플러그인 연결' })
  })

  it('relay-only: tells the user to install Figma when it is missing', () => {
    const v = describeBridge(state({ switchOn: true, status: 'relay-only', figmaInstalled: false, figmaRunning: false }))
    expect(v.detail).toContain('설치')
  })

  it('relay-only: hints that Figma will be started when it is not running', () => {
    const running = describeBridge(state({ switchOn: true, status: 'relay-only', figmaRunning: true }))
    const stopped = describeBridge(state({ switchOn: true, status: 'relay-only', figmaRunning: false }))
    expect(stopped.detail).not.toBe(running.detail)
  })

  it('connected: ok tone and a turn-off action', () => {
    const v = describeBridge(state({ switchOn: true, status: 'connected' }))
    expect(v.tone).toBe('ok')
    expect(v.action.kind).toBe('turn-off')
    expect(v.action.label).toBe('끄기')
  })

  it('the three states look different from each other', () => {
    const views = (['off', 'relay-only', 'connected'] as const).map((status) => describeBridge(state({ status })))
    expect(new Set(views.map((v) => v.tone)).size).toBe(3)
    expect(new Set(views.map((v) => v.headline)).size).toBe(3)
  })

  it.each([
    ['off', 'turn-on', '연동 중…'],
    ['relay-only', 'attach-plugin', '연결 중…'],
    ['connected', 'turn-off', '끄는 중…'],
  ] as const)('busy in %s keeps the action kind and shows progress text', (status, kind, label) => {
    const idle = describeBridge(state({ status }))
    const busy = describeBridge(state({ status, busy: true }))
    expect(busy.action).toEqual({ kind, label })
    expect(busy.action.label).not.toBe(idle.action.label)
    expect(busy.tone).toBe(idle.tone)
  })
})
