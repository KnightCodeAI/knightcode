---
"@knightcodeai/cli": minor
---

Added image input for classifier models on TypeSafe, Cloudflare Workers AI and OpenRouter, with Clef Omni and Jev 1.14 on Workers AI. A classifier model that lists image input now judges `images`, and a provider-level `compat` in `models.json` (`imageInput`, `sendImageOptInHeader`) tells a custom provider which request format its classifiers expect.
