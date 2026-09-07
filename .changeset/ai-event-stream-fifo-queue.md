---
"@knightcodeai/cli": patch
---

Fixed the event stream draining its buffered events with `Array.shift()`, which made delivery quadratic on long streams; both the event queue and the waiting-consumer queue now use an amortized O(1) FIFO.
