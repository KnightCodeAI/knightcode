---
"@knightcodeai/cli": patch
---

Fixed the default model for the Xiaomi providers. It was `mimo-v2.5-pro`, which Xiaomi no longer lists, so choosing a Xiaomi provider without a model found nothing; the default is now `mimo-v2.6-pro`.
