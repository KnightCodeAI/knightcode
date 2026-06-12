import { createTextAttributes } from '@opentui/core'
import type { ReactNode } from 'react'
import React, { createContext, useContext } from 'react'
import { toOpenTuiColor } from '../opentui-color.js'
import type { Color, Styles, TextStyles } from '../styles.js'

type BaseProps = {
  /**
   * Change text color. Accepts a raw color value (rgb, hex, ansi).
   */
  readonly color?: Color

  /**
   * Same as `color`, but for background.
   */
  readonly backgroundColor?: Color

  /**
   * Make the text italic.
   */
  readonly italic?: boolean

  /**
   * Make the text underlined.
   */
  readonly underline?: boolean

  /**
   * Make the text crossed with a line.
   */
  readonly strikethrough?: boolean

  /**
   * Inverse background and foreground colors.
   */
  readonly inverse?: boolean

  /**
   * Wrap or truncate text if its width is larger than container.
   */
  readonly wrap?: Styles['textWrap']

  readonly children?: ReactNode
}

/**
 * Bold and dim are mutually exclusive in terminals.
 * This type ensures you can use one or the other, but not both.
 */
type WeightProps =
  | { bold?: never; dim?: never }
  | { bold: boolean; dim?: never }
  | { dim: boolean; bold?: never }

export type Props = BaseProps & WeightProps

// Arbitrary <Text> nesting is allowed for inline styling. OpenTUI's text
// element hosts inline content as spans, so a Text inside another Text
// renders a <span> instead of opening a second text block.
const InsideTextContext = createContext(false)

function wrapMode(wrap: NonNullable<Styles['textWrap']>): 'word' | 'none' {
  // Truncation modes all map to no-wrap; OpenTUI clips at the box edge.
  return wrap === 'wrap' || wrap === 'wrap-trim' ? 'word' : 'none'
}

/**
 * This component can display text, and change its style to make it
 * colorful, bold, underline, italic or strikethrough.
 */
export default function Text({
  color,
  backgroundColor,
  bold,
  dim,
  italic = false,
  underline = false,
  strikethrough = false,
  inverse = false,
  wrap = 'wrap',
  children,
}: Props): React.ReactNode {
  const insideText = useContext(InsideTextContext)

  if (children === undefined || children === null) {
    return null
  }

  const textStyles: TextStyles = {
    ...(color && { color }),
    ...(backgroundColor && { backgroundColor }),
    ...(dim && { dim }),
    ...(bold && { bold }),
    ...(italic && { italic }),
    ...(underline && { underline }),
    ...(strikethrough && { strikethrough }),
    ...(inverse && { inverse }),
  }

  const attributes = createTextAttributes({
    bold: textStyles.bold,
    dim: textStyles.dim,
    italic: textStyles.italic,
    underline: textStyles.underline,
    strikethrough: textStyles.strikethrough,
    inverse: textStyles.inverse,
  })

  const fg = toOpenTuiColor(textStyles.color)
  const bg = toOpenTuiColor(textStyles.backgroundColor)

  if (insideText) {
    return (
      <span fg={fg} bg={bg} attributes={attributes}>
        {children}
      </span>
    )
  }

  return (
    <InsideTextContext.Provider value={true}>
      <text
        fg={fg}
        bg={bg}
        attributes={attributes}
        wrapMode={wrapMode(wrap)}
        truncate={wrap.startsWith('truncate') || wrap === 'end' || wrap === 'middle' ? true : undefined}
      >
        {children}
      </text>
    </InsideTextContext.Provider>
  )
}
