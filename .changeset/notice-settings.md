---
"@knightcodeai/cli": minor
---

Changed the single `showCacheMissNotices` setting into one setting per transcript notice (`notices.cacheMisses`, `notices.cacheWarming`, `notices.compactionCosts`, `notices.reasoningDrops`), with a Notices submenu in `/settings`; an existing `showCacheMissNotices` value is migrated to all four.
