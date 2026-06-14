// `plist` ships no bundled types. The notifier only uses plist.build() to
// serialize a macOS notification payload; this minimal ambient declaration
// covers that surface.
declare module 'plist' {
  export function build(value: unknown): string
  export function parse(xml: string): any
}
