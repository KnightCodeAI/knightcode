import type { BoxRenderable } from '@opentui/core'

// Downstream code treats DOMElement as an opaque ref target: it passes refs
// into measureElement() and the focus manager. With OpenTUI as the renderer,
// the natural ref target is the underlying BoxRenderable, which carries
// layout (x/y/width/height), the tree (parent/getChildren) and focus state.
export type DOMElement = BoxRenderable

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNodeAttribute = boolean | string | number
