// bidi-js ships no type declarations; declare the small surface we use.
// Keep this file an ambient script (no top-level import/export) so this stays
// an ambient module declaration. The JSX intrinsic augmentation lives in
// jsx-intrinsics.d.ts, which must be a module (it augments `react`).
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
