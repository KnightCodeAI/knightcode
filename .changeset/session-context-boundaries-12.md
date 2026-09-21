---
"@knightcodeai/cli": patch
---

Fixed prompt templates with invalid YAML frontmatter being dropped silently. They are now reported as resource warnings, and valid templates beside them still load.
