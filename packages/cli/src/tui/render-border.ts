import chalk from 'chalk'
import { type Boxes, type BoxStyle } from 'cli-boxes'
import { applyColor } from './colorize.js'
import { stringWidth } from './stringWidth.js'
import type { Color } from './styles.js'

export type BorderTextOptions = {
  content: string // Pre-rendered string with ANSI color codes
  position: 'top' | 'bottom'
  align: 'start' | 'end' | 'center'
  offset?: number // Only used with 'start' or 'end' alignment. Number of characters from the edge.
}

export const CUSTOM_BORDER_STYLES = {
  dashed: {
    top: '╌',
    left: '╎',
    right: '╎',
    bottom: '╌',
    // there aren't any line-drawing characters for dashes unfortunately
    topLeft: ' ',
    topRight: ' ',
    bottomLeft: ' ',
    bottomRight: ' ',
  },
} as const

export type BorderStyle =
  | keyof Boxes
  | keyof typeof CUSTOM_BORDER_STYLES
  | BoxStyle

function embedTextInBorder(
  borderLine: string,
  text: string,
  align: 'start' | 'end' | 'center',
  offset: number = 0,
  borderChar: string,
): [before: string, text: string, after: string] {
  const textLength = stringWidth(text)
  const borderLength = borderLine.length

  if (textLength >= borderLength - 2) {
    return ['', text.substring(0, borderLength), '']
  }

  let position: number
  if (align === 'center') {
    position = Math.floor((borderLength - textLength) / 2)
  } else if (align === 'start') {
    position = offset + 1 // +1 to account for corner character
  } else {
    // align === 'end'
    position = borderLength - textLength - offset - 1 // -1 for corner character
  }

  // Ensure position is valid
  position = Math.max(1, Math.min(position, borderLength - textLength - 1))

  const before = borderLine.substring(0, 1) + borderChar.repeat(position - 1)
  const after =
    borderChar.repeat(borderLength - position - textLength - 1) +
    borderLine.substring(borderLength - 1)

  return [before, text, after]
}

function styleBorderLine(
  line: string,
  color: Color | undefined,
  dim: boolean | undefined,
): string {
  let styled = applyColor(line, color)
  if (dim) {
    styled = chalk.dim(styled)
  }
  return styled
}
