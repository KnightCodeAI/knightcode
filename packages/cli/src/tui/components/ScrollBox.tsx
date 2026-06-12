import type { ScrollBoxRenderable } from '@opentui/core'
import React, {
  type PropsWithChildren,
  type Ref,
  useImperativeHandle,
  useRef,
} from 'react'
import type { Except } from 'type-fest'
import { translateBoxStyles } from './Box.js'
import type { DOMElement } from '../dom.js'
import type { Styles } from '../styles.js'

export type ScrollBoxHandle = {
  scrollTo: (y: number) => void
  scrollBy: (dy: number) => void
  /**
   * Scroll so `el`'s top is at the viewport top (plus `offset`).
   */
  scrollToElement: (el: DOMElement, offset?: number) => void
  scrollToBottom: () => void
  getScrollTop: () => number
  getPendingDelta: () => number
  getScrollHeight: () => number
  /**
   * Like getScrollHeight, but bypasses any render-cached value. With
   * OpenTUI the scroll metrics are always live, so this is the same read.
   */
  getFreshScrollHeight: () => number
  getViewportHeight: () => number
  /**
   * Absolute screen row of the first visible content line (inside padding).
   */
  getViewportTop: () => number
  /**
   * True when scroll is pinned to the bottom.
   */
  isSticky: () => boolean
  /**
   * Subscribe to imperative scroll changes (scrollTo/scrollBy/scrollToBottom).
   */
  subscribe: (listener: () => void) => () => void
  /**
   * Render-time scrollTop clamp for virtual scrolling. OpenTUI clamps
   * scroll positions natively, so this is a no-op kept for API parity.
   */
  setClampBounds: (min: number | undefined, max: number | undefined) => void
}

export type ScrollBoxProps = Except<
  Styles,
  'textWrap' | 'overflow' | 'overflowX' | 'overflowY'
> & {
  ref?: Ref<ScrollBoxHandle>
  /**
   * When true, automatically pins scroll position to the bottom when content
   * grows. Unset manually via scrollTo/scrollBy to break the stickiness.
   */
  stickyScroll?: boolean
}

/**
 * A Box with scrollable overflow and an imperative scroll API, backed by
 * OpenTUI's native scrollbox.
 */
function ScrollBox({
  children,
  ref,
  stickyScroll,
  ...style
}: PropsWithChildren<ScrollBoxProps>): React.ReactNode {
  const domRef = useRef<ScrollBoxRenderable>(null)
  const listenersRef = useRef(new Set<() => void>())

  const notify = () => {
    for (const l of listenersRef.current) l()
  }

  useImperativeHandle(
    ref,
    (): ScrollBoxHandle => ({
      scrollTo(y: number) {
        const el = domRef.current
        if (!el) return
        el.stickyScroll = false
        el.scrollTo({ x: el.scrollLeft, y: Math.max(0, Math.floor(y)) })
        notify()
      },
      scrollToElement(el: DOMElement, offset = 0) {
        const box = domRef.current
        if (!box) return
        box.stickyScroll = false
        box.scrollTo({ x: box.scrollLeft, y: Math.max(0, el.y + box.scrollTop - box.viewport.y + offset) })
        notify()
      },
      scrollBy(dy: number) {
        const el = domRef.current
        if (!el) return
        el.stickyScroll = false
        el.scrollBy(Math.floor(dy))
        notify()
      },
      scrollToBottom() {
        const el = domRef.current
        if (!el) return
        el.stickyScroll = true
        el.scrollTo({ x: el.scrollLeft, y: Math.max(0, el.scrollHeight - el.viewport.height) })
        notify()
      },
      getScrollTop() {
        return domRef.current?.scrollTop ?? 0
      },
      getPendingDelta() {
        // OpenTUI applies scroll deltas immediately; nothing is pending.
        return 0
      },
      getScrollHeight() {
        return domRef.current?.scrollHeight ?? 0
      },
      getFreshScrollHeight() {
        return domRef.current?.scrollHeight ?? 0
      },
      getViewportHeight() {
        return domRef.current?.viewport.height ?? 0
      },
      getViewportTop() {
        return domRef.current?.viewport.y ?? 0
      },
      isSticky() {
        return domRef.current?.stickyScroll ?? false
      },
      subscribe(listener: () => void) {
        listenersRef.current.add(listener)
        return () => listenersRef.current.delete(listener)
      },
      setClampBounds() {},
    }),
    [],
  )

  return (
    <scrollbox
      ref={domRef}
      stickyScroll={stickyScroll}
      stickyStart={stickyScroll ? 'bottom' : undefined}
      {...translateBoxStyles(style)}
    >
      {children}
    </scrollbox>
  )
}

export default ScrollBox
