---
"@knightcodeai/cli": patch
---

Security Updated the HTTP client from 8.12.3 to 8.12.4. A redirect chain is no longer cached under the wrong address, credentials no longer follow a cross-origin redirect when headers are sent as name/value pairs, and a failure while replaying a cached response is reported as a request error instead of crashing the process.
