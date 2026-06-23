import { describe, expect, test } from 'bun:test'
import sharpImport from 'sharp'
import {
  detectImageFormatFromBuffer,
  maybeResizeAndDownsampleImageBuffer,
} from './imageResizer.js'

const sharp = sharpImport as unknown as typeof import('sharp').default

describe('imageResizer', () => {
  test('detectImageFormatFromBuffer reads magic bytes', async () => {
    const png = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#f00' },
    })
      .png()
      .toBuffer()
    expect(detectImageFormatFromBuffer(png)).toBe('image/png')

    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: '#0f0' },
    })
      .jpeg()
      .toBuffer()
    expect(detectImageFormatFromBuffer(jpeg)).toBe('image/jpeg')
  })

  test('an in-bounds image passes through with dimensions', async () => {
    const buf = await sharp({
      create: { width: 100, height: 50, channels: 3, background: '#00f' },
    })
      .png()
      .toBuffer()
    const result = await maybeResizeAndDownsampleImageBuffer(
      buf,
      buf.length,
      'png',
    )
    expect(result.dimensions?.originalWidth).toBe(100)
    expect(result.dimensions?.displayWidth).toBe(100)
  })

  test('an over-wide image is resized within IMAGE_MAX_WIDTH (2000)', async () => {
    const buf = await sharp({
      create: { width: 3000, height: 600, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer()
    const result = await maybeResizeAndDownsampleImageBuffer(
      buf,
      buf.length,
      'png',
    )
    expect(result.dimensions?.originalWidth).toBe(3000)
    expect(result.dimensions?.displayWidth ?? 0).toBeLessThanOrEqual(2000)
    // aspect ratio preserved (3000x600 -> 2000x400)
    expect(result.dimensions?.displayHeight ?? 0).toBeLessThanOrEqual(400)
  })

  test('an empty buffer throws ImageResizeError', async () => {
    await expect(
      maybeResizeAndDownsampleImageBuffer(Buffer.alloc(0), 0, 'png'),
    ).rejects.toThrow(/empty/i)
  })
})
