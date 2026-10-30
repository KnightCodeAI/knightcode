---
"@knightcodeai/cli": patch
---

Fixed `knightcode -e npm:<pkg>` staying on the version from the first download. On each start and `/reload`, an `-e` npm package without an exact version is reinstalled when the registry has a newer matching version. `knightcode -e git:<repo>@<branch>` likewise stayed on its first checkout and is now fetched and reset to the branch; a commit-hash ref that is already checked out is not fetched. Offline mode and failed checks keep the cached copy.
