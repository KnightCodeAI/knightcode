---
"@knightcodeai/cli": patch
---

Changed the streaming working indicator to render in the editor's top border instead of on its own row above it, so the editor no longer shifts up and down as a turn starts and finishes. It picks up the editor's border colour, which already tracks the thinking level. Custom editors from extensions keep the standalone row unless they opt in with `embedWorkingStatus`.
