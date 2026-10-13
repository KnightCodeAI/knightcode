---
"@knightcodeai/cli": patch
---

Fixed credential updates failing on Windows with EPERM when a just-removed `auth.json.lock` directory was still delete-pending; the lock is now retried briefly.
