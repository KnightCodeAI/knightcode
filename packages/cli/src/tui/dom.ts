import type { BoxRenderable } from '@opentui/core'
import type { LayoutNode } from './layout/node.js'

// Downstream code treats DOMElement as an opaque ref target: it passes refs
// into measureElement() and the focus manager. With OpenTUI as the renderer,
// the natural ref target is the underlying BoxRenderable, which carries
// layout (x/y/width/height), the tree (parent/getChildren) and focus state.
//
// The renderer keeps the element's Yoga node protected; the upstream
// transcript/scroll code reads computed layout off it directly (as ink's
// DOMElement exposed it), so the seam re-publishes it as `yogaNode`.
export type DOMElement = BoxRenderable & { readonly yogaNode: LayoutNode }

// eslint-disable-next-line @typescript-eslint/naming-convention
export type DOMNodeAttribute = boolean | string | number
