---
"@knightcodeai/cli": patch
---

Fixed `fd` and `ripgrep` failing to download behind shared egress IPs, where the anonymous GitHub API rate limit is permanently exhausted. The latest release is now resolved from the release page redirect, which costs no API quota. A failed download also reports the underlying network error instead of a bare "fetch failed".
