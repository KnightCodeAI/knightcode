// TODO: the native image processor (image-processor-napi) is not bundled in
// this build. Every call site loads it via a guarded dynamic import() and falls
// back to sharp/osascript when it is absent, so no runtime module is provided —
// this ambient declaration exists only so those verbatim imports type-check.
declare module 'image-processor-napi' {
  // Loaded only via guarded dynamic import(); typed loosely (the real native
  // surface is sharp-compatible) so the verbatim call sites type-check.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export const sharp: any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const _default: any
  export default _default
  export function getNativeModule():
    | {
        hasClipboardImage?: () => boolean
        readClipboardImage?: (
          maxWidth: number,
          maxHeight: number,
        ) =>
          | {
              png: Buffer
              originalWidth: number
              originalHeight: number
              width: number
              height: number
            }
          | null
      }
    | undefined
}
