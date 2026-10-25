---
"@knightcodeai/cli": patch
---

Fixed model references whose provider id contains a slash, such as a URL-derived provider, by matching the whole provider id.
