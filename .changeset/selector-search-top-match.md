---
"@knightcodeai/cli": patch
---

Fixed searching in /login, /logout, /scoped-models and /resume after scrolling: typing a query now selects the best match instead of whatever row the highlight was on, so Enter no longer opens the wrong provider or session.
