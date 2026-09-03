---
"@knightcodeai/cli": patch
---

Fixed Baseten's GLM-5.2 and GLM-5.2-Fast being advertised as accepting images. The catalog reports image input for them but the endpoints are text-only, so attaching an image produced a provider error instead of being caught up front.
