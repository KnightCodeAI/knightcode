---
"@knightcodeai/cli": patch
---

Fixed glob patterns in model selection and package filters being able to hang KnightCode: crafted patterns could make glob matching take exponential time. Glob matching now uses a matcher without regular expressions.
