// TODO: remote-control bridge handle registry — owned by the knightcode.raghavseth.in
// remote-control feature. Local-only build never holds a live handle.
import type { ReplBridgeHandle } from './replBridge.js'

export function setReplBridgeHandle(_handle: ReplBridgeHandle | null): void {}

// Local-only build never holds a live remote-control bridge, so cross-machine
// peer messaging (SendMessage to a `bridge:` address) is unavailable: callers
// see a null handle and fall back to local/in-process delivery.
export function getReplBridgeHandle(): ReplBridgeHandle | null {
  return null
}
