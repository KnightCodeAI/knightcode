---
"@knightcodeai/cli": patch
---

Fixed `RpcClient` skipping the next listener when one unsubscribes while an event is dispatched.
