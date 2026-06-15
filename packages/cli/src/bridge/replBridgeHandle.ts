// TODO: remote-control bridge handle registry — owned by the knightcode.raghavseth.in
// remote-control feature. Local-only build never holds a live handle.
import type { ReplBridgeHandle } from './replBridge.js'

export function setReplBridgeHandle(_handle: ReplBridgeHandle | null): void {}
