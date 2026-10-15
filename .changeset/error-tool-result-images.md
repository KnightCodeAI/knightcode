---
"@knightcodeai/cli": patch
---

Fixed images in failed tool results being replaced by a note for Anthropic and for Claude on Bedrock. Both reject images inside an error tool result, so the images are now sent right after the turn's tool results with a caption naming the tool call.
