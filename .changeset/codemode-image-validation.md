---
"@knightcodeai/cli": patch
---

Fixed codemode `image()` accepting malformed base64 data or unsupported image types, which stored an invalid image block that made every later provider request fail with HTTP 400. It now throws a `TypeError` unless the data is valid base64 of a PNG, JPEG, GIF, or WebP image, takes the MIME type from the image signature, and strips line breaks from wrapped base64.
