---
"@knightcodeai/cli": patch
---

Fixed a Zhipu / Z.ai plan that reached its usage limit (HTTP 429 with error code `1308`) being retried: the limit resets after hours, so the retries only delayed the error by about 14 seconds. It is now reported at once.
