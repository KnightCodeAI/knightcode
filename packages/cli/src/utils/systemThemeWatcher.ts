import { oscColor, type TerminalQuerier } from '../tui/terminal-querier.js'
import {
  setCachedSystemTheme,
  themeFromOscColor,
  type SystemTheme,
} from './systemTheme.js'

const POLL_INTERVAL_MS = 2_000

/**
 * Watch the terminal's background color (OSC 11) and report light/dark
 * changes while the 'auto' theme setting is active. Returns a cleanup
 * function that stops the polling.
 */
export function watchSystemTheme(
  querier: TerminalQuerier,
  onChange: (theme: SystemTheme) => void,
): () => void {
  let stopped = false
  let last: SystemTheme | undefined

  const poll = async () => {
    const pending = querier.send(oscColor(11))
    void querier.flush()
    const response = await pending
    if (stopped || !response) return
    const theme = themeFromOscColor(response.data)
    if (theme && theme !== last) {
      last = theme
      setCachedSystemTheme(theme)
      onChange(theme)
    }
  }

  void poll()
  const interval = setInterval(() => void poll(), POLL_INTERVAL_MS)

  return () => {
    stopped = true
    clearInterval(interval)
  }
}
