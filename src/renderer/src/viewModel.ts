import type { BridgeState } from '@shared/types'
import { viewMessages as m } from '../../main/messages'

export interface BridgeView {
  tone: 'off' | 'warn' | 'ok'
  headline: string
  detail: string
  action: { kind: 'turn-on' | 'attach-plugin' | 'turn-off'; label: string }
}

// Pure mapping from state to what the first screen shows; the DOM code only renders it.
export function describeBridge(state: BridgeState): BridgeView {
  switch (state.status) {
    case 'off':
      return {
        tone: 'off',
        headline: m.offHeadline,
        detail: m.offDetail,
        action: { kind: 'turn-on', label: state.busy ? m.turningOn : m.turnOn },
      }
    case 'relay-only':
      return {
        tone: 'warn',
        headline: m.relayOnlyHeadline,
        detail: !state.figmaInstalled
          ? m.relayOnlyFigmaMissing
          : state.figmaRunning
            ? m.relayOnlyDetail
            : m.relayOnlyFigmaStopped,
        action: { kind: 'attach-plugin', label: state.busy ? m.attaching : m.attachPlugin },
      }
    case 'connected':
      return {
        tone: 'ok',
        headline: m.connectedHeadline,
        detail: m.connectedDetail,
        action: { kind: 'turn-off', label: state.busy ? m.turningOff : m.turnOff },
      }
  }
}
