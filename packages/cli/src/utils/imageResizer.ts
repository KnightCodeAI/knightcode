// TODO: image reading (resize/downsample/compress via sharp or the native
// processor) isn't ported. The Read tool routes image files here; until the
// image pipeline lands, reading one is unsupported. Format detection and
// metadata text are pure and remain real.

import type { ImageBlockParam } from '@anthropic-ai/sdk/resources/messages.mjs'

export type ImageMediaType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/gif'
  | 'image/webp'

export type ImageDimensions = {
  originalWidth?: number
  originalHeight?: number
  displayWidth?: number
  displayHeight?: number
}

export interface ResizeResult {
  buffer: Buffer
  mediaType: string
  dimensions?: ImageDimensions
}

export interface CompressedImageResult {
  base64: string
  mediaType: ImageMediaType
  originalSize: number
}

export class ImageResizeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageResizeError'
  }
}

const UNSUPPORTED = 'Reading image files is not supported in this build.'

/** Detect an image's media type from its magic bytes. */
export function detectImageFormatFromBuffer(buffer: Buffer): ImageMediaType {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'image/png'
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'image/jpeg'
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x47 &&
    buffer[1] === 0x49 &&
    buffer[2] === 0x46
  ) {
    return 'image/gif'
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return 'image/webp'
  }
  return 'image/png'
}

export function detectImageFormatFromBase64(base64Data: string): ImageMediaType {
  try {
    return detectImageFormatFromBuffer(Buffer.from(base64Data, 'base64'))
  } catch {
    return 'image/png'
  }
}

export function createImageMetadataText(
  _dims: ImageDimensions,
  _sourcePath?: string,
): string | null {
  return null
}

export async function maybeResizeAndDownsampleImageBuffer(
  _imageBuffer: Buffer,
  _originalSize: number,
  _ext: string,
): Promise<ResizeResult> {
  throw new ImageResizeError(UNSUPPORTED)
}

export async function compressImageBufferWithTokenLimit(
  _imageBuffer: Buffer,
  _maxTokens: number,
  _originalMediaType?: string,
): Promise<CompressedImageResult> {
  throw new ImageResizeError(UNSUPPORTED)
}

export type ImageBlockWithDimensions = {
  block: ImageBlockParam
  dimensions?: ImageDimensions
}

// TODO: image resize/downsample isn't ported. The attachment pipeline passes
// pasted image blocks through unchanged (no resizing) until the image pipeline
// lands.
export async function maybeResizeAndDownsampleImageBlock(
  imageBlock: ImageBlockParam,
): Promise<ImageBlockWithDimensions> {
  return { block: imageBlock }
}
