---
"@knightcodeai/cli": patch
---

Security updated the webfetch regex dependency `re2js` to 2.8.7 to address
CVE-2026-116795. KnightCode does not enable the affected lookbehind feature.
