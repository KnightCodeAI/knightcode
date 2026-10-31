---
"@knightcodeai/cli": patch
---

Fixed extension renderers showing hints such as " to expand" with no key. An extension that imports `keyHint`/`keyText` can load its own copy of `@knightcodeai/cli`, which never sees your keybindings. Tool renderers now get `context.keyText()`/`context.keyHint()`, and message and entry renderers get `options.keyText()`/`options.keyHint()`, which format your configured keys; the extension docs and the `debug-provider` example use them.
