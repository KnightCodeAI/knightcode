// bidi-js ships no type declarations; declare the small surface we use.
declare module 'bidi-js' {
  type EmbeddingLevelsResult = {
    levels: Uint8Array
    paragraphs: { start: number; end: number; level: number }[]
  }

  type Bidi = {
    getEmbeddingLevels(
      text: string,
      explicitDirection?: 'ltr' | 'rtl' | 'auto',
    ): EmbeddingLevelsResult
  }

  export default function bidiFactory(): Bidi
}
