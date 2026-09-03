---
"@knightcodeai/cli": minor
---

Added a transcript notice for thinking blocks the provider drops. A stale signed prefix is now recovered from silently rather than failing the request, so the recovery is reported instead of passing unseen. Shown when `showCacheMissNotices` is enabled.
