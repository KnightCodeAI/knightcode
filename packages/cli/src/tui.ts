import { createElement, type ReactNode } from 'react'
import { ThemeProvider } from './components/design-system/ThemeProvider.js'
import tuiRender, {
  type Instance,
  createRoot as tuiCreateRoot,
  type RenderOptions,
  type Root,
} from './tui/root.js'

export type { RenderOptions, Instance, Root }

// Wrap all render calls with ThemeProvider so ThemedBox/ThemedText work
// without every call site having to mount it. The renderer itself is theme-agnostic.
function withTheme(node: ReactNode): ReactNode {
  return createElement(ThemeProvider, null, node)
}

export async function render(
  node: ReactNode,
  options?: NodeJS.WriteStream | RenderOptions,
): Promise<Instance> {
  return tuiRender(withTheme(node), options)
}

export async function createRoot(options?: RenderOptions): Promise<Root> {
  const root = await tuiCreateRoot(options)
  return {
    ...root,
    render: node => root.render(withTheme(node)),
  }
}

export { color } from './components/design-system/color.js'
export type { Props as BoxProps } from './components/design-system/ThemedBox.js'
export { default as Box } from './components/design-system/ThemedBox.js'
export type { Props as TextProps } from './components/design-system/ThemedText.js'
export { default as Text } from './components/design-system/ThemedText.js'
export {
  ThemeProvider,
  usePreviewTheme,
  useTheme,
  useThemeSetting,
} from './components/design-system/ThemeProvider.js'
export { Ansi } from './tui/Ansi.js'
export type { Props as AppProps } from './tui/components/AppContext.js'
export type { Props as BaseBoxProps } from './tui/components/Box.js'
export { default as BaseBox } from './tui/components/Box.js'
export type {
  ButtonState,
  Props as ButtonProps,
} from './tui/components/Button.js'
export { default as Button } from './tui/components/Button.js'
export type { Props as LinkProps } from './tui/components/Link.js'
export { default as Link } from './tui/components/Link.js'
export type { Props as NewlineProps } from './tui/components/Newline.js'
export { default as Newline } from './tui/components/Newline.js'
export { NoSelect } from './tui/components/NoSelect.js'
export { RawAnsi } from './tui/components/RawAnsi.js'
export { default as Spacer } from './tui/components/Spacer.js'
export type { Props as StdinProps } from './tui/components/StdinContext.js'
export type { Props as BaseTextProps } from './tui/components/Text.js'
export { default as BaseText } from './tui/components/Text.js'
export type { DOMElement } from './tui/dom.js'
export { ClickEvent } from './tui/events/click-event.js'
export { EventEmitter } from './tui/events/emitter.js'
export { Event } from './tui/events/event.js'
export type { Key } from './tui/events/input-event.js'
export { InputEvent } from './tui/events/input-event.js'
export type { TerminalFocusEventType } from './tui/events/terminal-focus-event.js'
export { TerminalFocusEvent } from './tui/events/terminal-focus-event.js'
export { FocusManager } from './tui/focus.js'
export type { FlickerReason } from './tui/frame.js'
export { useAnimationFrame } from './tui/hooks/use-animation-frame.js'
export { default as useApp } from './tui/hooks/use-app.js'
export { default as useInput } from './tui/hooks/use-input.js'
export { useAnimationTimer, useInterval } from './tui/hooks/use-interval.js'
export { useSelection } from './tui/hooks/use-selection.js'
export { default as useStdin } from './tui/hooks/use-stdin.js'
export { useTabStatus } from './tui/hooks/use-tab-status.js'
export { useTerminalFocus } from './tui/hooks/use-terminal-focus.js'
export { useTerminalTitle } from './tui/hooks/use-terminal-title.js'
export { useTerminalViewport } from './tui/hooks/use-terminal-viewport.js'
export { default as measureElement } from './tui/measure-element.js'
export { supportsTabStatus } from './tui/termio/osc.js'
export { default as wrapText } from './tui/wrap-text.js'
