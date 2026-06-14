// TODO: context-collapse projection (rewriting the message view so /context
// reflects what the API actually sees after collapsing spans) lands with the
// context-collapse subsystem. It runs behind a feature gate that is off in this
// build, so the projection is the identity — the view is returned unchanged.

import type { Message } from '../../types/message.js'

export function projectView(view: Message[]): Message[] {
  return view
}
