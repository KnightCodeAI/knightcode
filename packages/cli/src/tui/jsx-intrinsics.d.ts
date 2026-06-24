// JSX intrinsic elements rendered by the Ink reconciler. These were declared in
// the upstream `global.d.ts` that the vendored source omitted; redeclared here
// so the host components (<Box>, <Text>, <Link>, <RawAnsi>, ScrollBox) resolve.
// React 19's automatic runtime looks up intrinsics on the `JSX` namespace
// exported by `react` (not the global one, which @types/react@19 no longer
// provides), so augment that. The trailing `export {}` makes this file a module
// so `declare module 'react'` augments React's types rather than replacing them.
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'ink-root': { children?: import('react').ReactNode }
      'ink-box': {
        ref?: import('react').Ref<import('./dom.js').DOMElement>
        style?: import('./styles.js').Styles
        tabIndex?: number
        autoFocus?: boolean
        stickyScroll?: boolean
        onClick?: (event: import('./events/click-event.js').ClickEvent) => void
        onFocus?: (event: import('./events/focus-event.js').FocusEvent) => void
        onFocusCapture?: (
          event: import('./events/focus-event.js').FocusEvent,
        ) => void
        onBlur?: (event: import('./events/focus-event.js').FocusEvent) => void
        onBlurCapture?: (
          event: import('./events/focus-event.js').FocusEvent,
        ) => void
        onKeyDown?: (
          event: import('./events/keyboard-event.js').KeyboardEvent,
        ) => void
        onKeyDownCapture?: (
          event: import('./events/keyboard-event.js').KeyboardEvent,
        ) => void
        onMouseEnter?: () => void
        onMouseLeave?: () => void
        children?: import('react').ReactNode
      }
      'ink-text': {
        style?: import('./styles.js').Styles
        textStyles?: import('./styles.js').TextStyles
        children?: import('react').ReactNode
      }
      'ink-virtual-text': { children?: import('react').ReactNode }
      'ink-link': { href: string; children?: import('react').ReactNode }
      'ink-raw-ansi': { rawText: string; rawWidth: number; rawHeight: number }
    }
  }
}

export {}
