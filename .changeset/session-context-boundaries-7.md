---
"@knightcodeai/cli": patch
---

Added per-model image resize profiles through `inputLimits.images.resize` in `models.json` and `modelOverrides`. File attachments, `read` and tool-result images are resized once for the selected model before they enter history; built-in vision models carry the previous 2000x2000, 4.5 MiB default explicitly.
