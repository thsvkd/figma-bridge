// Wait limits for driving the Figma desktop app. Values marked "legacy" come from lib/Plugin.ps1,
// which worked in the field; re-measure them with the Win32 smoke test in docs/manual-checklist.md.
export const timings = {
  /** Poll interval while waiting for the Figma window to become foreground. */
  focusPollMs: 25,
  /** Upper bound for one focus() call. */
  focusTimeoutMs: 1000,
  /** Gap between key chords so Figma processes each one before the next arrives. */
  keyGapMs: 30,
  /** Ctrl+/ until the quick action palette accepts typing (legacy: 600). */
  quickActionOpenMs: 600,
  /** Typing the plugin name until the search result is ready for Enter (legacy: 900). */
  quickActionSearchMs: 900,
  /** Poll interval and upper bound while waiting for a Figma window after launch (legacy: 500 / 30 s). */
  windowPollMs: 250,
  windowTimeoutMs: 30_000,
  /** Poll interval and upper bound while waiting for the plugin to join the relay (legacy: 500 / 12 s). */
  attachPollMs: 250,
  attachTimeoutMs: 12_000,
} as const
