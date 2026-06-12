import { RGBA } from '@opentui/core'
import type { Color } from './styles.js'

// The 16 standard ANSI colors, using the xterm default palette.
const ANSI16: Record<string, string> = {
  black: '#000000',
  red: '#cd0000',
  green: '#00cd00',
  yellow: '#cdcd00',
  blue: '#0000ee',
  magenta: '#cd00cd',
  cyan: '#00cdcd',
  white: '#e5e5e5',
  blackBright: '#7f7f7f',
  redBright: '#ff0000',
  greenBright: '#00ff00',
  yellowBright: '#ffff00',
  blueBright: '#5c5cff',
  magentaBright: '#ff00ff',
  cyanBright: '#00ffff',
  whiteBright: '#ffffff',
}

/** xterm 256-color palette index → [r, g, b]. */
function ansi256ToRgb(n: number): [number, number, number] {
  if (n < 16) {
    const hex = Object.values(ANSI16)[n]!
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
    ]
  }
  if (n < 232) {
    // 6×6×6 color cube
    const i = n - 16
    const steps = [0, 95, 135, 175, 215, 255]
    return [
      steps[Math.floor(i / 36) % 6]!,
      steps[Math.floor(i / 6) % 6]!,
      steps[i % 6]!,
    ]
  }
  // Grayscale ramp
  const v = 8 + (n - 232) * 10
  return [v, v, v]
}

/**
 * Translate a Styles color value (`#hex`, `rgb(r,g,b)`, `ansi256(n)`,
 * `ansi:name`) into something OpenTUI's color parser accepts.
 */
export function toOpenTuiColor(color: Color | undefined): string | RGBA | undefined {
  if (!color) return undefined

  if (color.startsWith('#')) return color

  const rgbMatch = color.match(/^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/)
  if (rgbMatch) {
    return RGBA.fromInts(
      Number(rgbMatch[1]),
      Number(rgbMatch[2]),
      Number(rgbMatch[3]),
      255,
    )
  }

  const ansi256Match = color.match(/^ansi256\((\d+)\)$/)
  if (ansi256Match) {
    const [r, g, b] = ansi256ToRgb(Number(ansi256Match[1]))
    return RGBA.fromInts(r, g, b, 255)
  }

  if (color.startsWith('ansi:')) {
    return ANSI16[color.slice(5)] ?? color.slice(5)
  }

  return color
}

/** Apply terminal "dim" to a color by scaling its channels down. */
export function dimColor(color: string | RGBA | undefined): string | RGBA | undefined {
  if (color === undefined) return undefined
  const rgba = typeof color === 'string' ? RGBA.fromHex(color) : color
  return RGBA.fromValues(rgba.r * 0.6, rgba.g * 0.6, rgba.b * 0.6, rgba.a)
}
