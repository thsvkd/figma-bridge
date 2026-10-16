// Everything the plugin launcher needs from the Figma desktop app. The Win32 implementation lives in win32.ts.
export interface FigmaDriver {
  isInstalled(): boolean
  isRunning(): Promise<boolean>
  /** Starts Figma only when it is not running yet. */
  launch(): Promise<void>
  waitForWindow(timeoutMs: number): Promise<boolean>
  /** Brings the Figma window to the front and reports whether it actually became foreground. */
  focus(): Promise<boolean>
  isFigmaForeground(): boolean
  /** Esc, Ctrl+/, the plugin name as unicode input, Enter. Rejects when focus leaves Figma midway. */
  sendQuickAction(pluginName: string): Promise<void>
  /** Esc, Ctrl+Alt+P. Rejects when focus leaves Figma midway. */
  sendRunLast(): Promise<void>
  /** Opens the URL inside the Figma app. */
  openPluginPage(url: string): Promise<void>
  /** Foreground window handle (0 when there is none). */
  captureForeground(): number
  restoreForeground(handle: number): void
}
