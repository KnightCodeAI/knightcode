---
"@knightcodeai/cli": patch
---

Fixed bare URLs in Markdown swallowing the CJK punctuation and text that follow them (`https://example.com。后面的中文` linked the whole run). A bare URL now ends at CJK punctuation; explicit links and `<...>` autolinks can still contain it.
