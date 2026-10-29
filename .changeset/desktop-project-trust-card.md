---
"@knightcode/desktop": patch
---

Fixed a new project never asking to be trusted. A project with its own extensions, skills or settings now asks on the new-thread screen, with Trust and Not now. Trust records the decision in the same trust store the terminal uses, so the project's own resources load in its threads; before, the only way to trust a project was the switch in Settings. In a narrow window, the new-thread screen's cards now put their buttons under the text instead of squeezing it.
