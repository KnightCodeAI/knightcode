---
"@knightcodeai/cli": patch
---

Fixed `knightcode update` reporting every install as a standalone binary. `bin/knightcode` spawns the compiled binary out of `node_modules`, so install detection now classifies a binary by where it sits rather than by how it was built, and moves the running executable aside on Windows so npm can replace it.
