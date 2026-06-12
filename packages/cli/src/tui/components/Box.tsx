import type { BorderCharacters, BoxOptions } from '@opentui/core'
import React, { type PropsWithChildren, type Ref, useCallback } from 'react'
import type { Except } from 'type-fest'
import type { DOMElement } from '../dom.js'
import { ClickEvent } from '../events/click-event.js'
import type { FocusEvent } from '../events/focus-event.js'
import type { KeyboardEvent } from '../events/keyboard-event.js'
import { setTabIndex } from '../focus.js'
import { dimColor, toOpenTuiColor } from '../opentui-color.js'
import { CUSTOM_BORDER_STYLES } from '../render-border.js'
import type { Styles } from '../styles.js'

export type Props = Except<Styles, 'textWrap'> & {
  ref?: Ref<DOMElement>
  /**
   * Tab order index. Nodes with `tabIndex >= 0` participate in
   * Tab/Shift+Tab cycling; `-1` means programmatically focusable only.
   */
  tabIndex?: number
  /**
   * Focus this element when it mounts.
   */
  autoFocus?: boolean
  /**
   * Fired on left-button click. Only works where mouse tracking is
   * enabled — no-op otherwise.
   */
  onClick?: (event: ClickEvent) => void
  onFocus?: (event: FocusEvent) => void
  onFocusCapture?: (event: FocusEvent) => void
  onBlur?: (event: FocusEvent) => void
  onBlurCapture?: (event: FocusEvent) => void
  onKeyDown?: (event: KeyboardEvent) => void
  onKeyDownCapture?: (event: KeyboardEvent) => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
}

// Upstream border styles are cli-boxes names; OpenTUI has four native styles and
// takes explicit characters for everything else.
const BORDER_STYLE_MAP: Record<string, BoxOptions['borderStyle']> = {
  single: 'single',
  double: 'double',
  round: 'rounded',
  bold: 'heavy',
}

type StyleBorderChars = {
  topLeft: string
  top: string
  topRight: string
  right: string
  bottomRight: string
  bottom: string
  bottomLeft: string
  left: string
}

function toBorderCharacters(box: StyleBorderChars): BorderCharacters {
  return {
    topLeft: box.topLeft,
    topRight: box.topRight,
    bottomLeft: box.bottomLeft,
    bottomRight: box.bottomRight,
    horizontal: box.top,
    vertical: box.left,
    topT: box.top,
    bottomT: box.bottom,
    leftT: box.left,
    rightT: box.right,
    cross: '┼',
  }
}

/** Translate the Styles object onto OpenTUI box options. */
export function translateBoxStyles(style: Except<Styles, 'textWrap'>): Record<string, unknown> {
  const out: Record<string, unknown> = {}

  // Layout props that pass through with the same name and value space.
  const passthrough = [
    'flexGrow',
    'flexShrink',
    'flexDirection',
    'alignItems',
    'alignSelf',
    'justifyContent',
    'width',
    'height',
    'minWidth',
    'minHeight',
    'maxWidth',
    'maxHeight',
    'margin',
    'marginX',
    'marginY',
    'marginTop',
    'marginBottom',
    'marginLeft',
    'marginRight',
    'padding',
    'paddingX',
    'paddingY',
    'paddingTop',
    'paddingBottom',
    'paddingLeft',
    'paddingRight',
    'gap',
    'rowGap',
    'columnGap',
    'position',
    'top',
    'bottom',
    'left',
    'right',
    'overflow',
  ] as const
  for (const key of passthrough) {
    if (style[key] !== undefined) out[key] = style[key]
  }

  if (style.flexWrap !== undefined) {
    out['flexWrap'] = style.flexWrap === 'nowrap' ? 'no-wrap' : style.flexWrap
  }
  if (style.flexBasis !== undefined) {
    out['flexBasis'] = style.flexBasis
  }
  if (style.display === 'none') {
    out['visible'] = false
  }

  // overflowX/overflowY: OpenTUI has a single overflow axis setting; the
  // stricter of the two wins so clipped content stays clipped.
  const overflowAxis = style.overflowY ?? style.overflowX
  if (out['overflow'] === undefined && overflowAxis !== undefined) {
    out['overflow'] = overflowAxis
  }

  if (style.borderStyle !== undefined) {
    if (typeof style.borderStyle === 'string') {
      const native = BORDER_STYLE_MAP[style.borderStyle]
      if (native) {
        out['borderStyle'] = native
      } else if (style.borderStyle in CUSTOM_BORDER_STYLES) {
        out['customBorderChars'] = toBorderCharacters(
          CUSTOM_BORDER_STYLES[
            style.borderStyle as keyof typeof CUSTOM_BORDER_STYLES
          ],
        )
      } else {
        // Other cli-boxes names (classic, arrow, ...) degrade to single.
        out['borderStyle'] = 'single'
      }
    } else {
      out['customBorderChars'] = toBorderCharacters(style.borderStyle as StyleBorderChars)
    }

    // Per-side visibility: Styles uses borderTop/borderBottom/... booleans
    // defaulting to true; OpenTUI takes the list of visible sides.
    const sides = (['top', 'right', 'bottom', 'left'] as const).filter(side => {
      const flag = {
        top: style.borderTop,
        right: style.borderRight,
        bottom: style.borderBottom,
        left: style.borderLeft,
      }[side]
      return flag !== false
    })
    out['border'] = sides.length === 4 ? true : sides

    let borderColor = toOpenTuiColor(style.borderColor)
    if (style.borderDimColor && borderColor) {
      borderColor = dimColor(borderColor)
    }
    if (borderColor !== undefined) out['borderColor'] = borderColor
    // TODO: per-side border colors (borderTopColor etc.) — OpenTUI draws the
    // whole border in one color, so those degrade to the shared color.
  }

  if (style.backgroundColor !== undefined) {
    out['backgroundColor'] = toOpenTuiColor(style.backgroundColor)
  }

  if (style.borderText !== undefined) {
    const { content, position, align } = style.borderText
    const alignment =
      align === 'start' ? 'left' : align === 'end' ? 'right' : 'center'
    if (position === 'top') {
      out['title'] = content
      out['titleAlignment'] = alignment
    } else {
      out['bottomTitle'] = content
      out['bottomTitleAlignment'] = alignment
    }
  }

  if (style.noSelect !== undefined && style.noSelect !== false) {
    out['selectable'] = false
  }

  return out
}

/**
 * `<Box>` is the essential layout component. It's like
 * `<div style="display: flex">` in the browser.
 */
function Box({
  children,
  flexWrap = 'nowrap',
  flexDirection = 'row',
  flexGrow = 0,
  flexShrink = 1,
  ref,
  tabIndex,
  autoFocus,
  onClick,
  onFocus,
  onFocusCapture,
  onBlur,
  onBlurCapture,
  onMouseEnter,
  onMouseLeave,
  onKeyDown,
  onKeyDownCapture,
  ...style
}: PropsWithChildren<Props>): React.ReactNode {
  const setRef = useCallback(
    (node: DOMElement | null) => {
      if (node && tabIndex !== undefined) setTabIndex(node, tabIndex)
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref, tabIndex],
  )

  // TODO: onFocus/onBlur/onKeyDown/onMouseEnter/onMouseLeave need the
  // capture/bubble dispatcher from the alt-screen mouse + focus work;
  // they are accepted (so callers typecheck) but not yet dispatched.
  void onFocus
  void onFocusCapture
  void onBlur
  void onBlurCapture
  void onMouseEnter
  void onMouseLeave
  void onKeyDown
  void onKeyDownCapture

  const translated = translateBoxStyles({
    flexWrap,
    flexDirection,
    flexGrow,
    flexShrink,
    ...style,
    overflowX: style.overflowX ?? style.overflow ?? 'visible',
    overflowY: style.overflowY ?? style.overflow ?? 'visible',
  })

  return (
    <box
      ref={setRef}
      focusable={tabIndex !== undefined || undefined}
      focused={autoFocus || undefined}
      onMouseUp={
        onClick
          ? event => {
              // OpenTUI reports absolute terminal coords; ClickEvent
              // carries both absolute and handler-relative positions.
              onClick(new ClickEvent(event.x, event.y, false))
            }
          : undefined
      }
      {...translated}
    >
      {children}
    </box>
  )
}

export default Box
