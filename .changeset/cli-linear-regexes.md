---
"@knightcodeai/cli": patch
---

Fixed regular expressions for provider error messages, npm package specs, and LaTeX sub/superscripts that slowed down quadratically on long runs of whitespace or slashes. They now run in linear time and match exactly the same strings.
