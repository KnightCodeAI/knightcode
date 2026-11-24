---
"@knightcodeai/cli": patch
---

Fixed Google and Vertex streams so a blocked prompt is reported as a policy error, and a stream that ends with no finish reason is reported as empty.
