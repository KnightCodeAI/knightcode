# @knightcode/tui

## 0.1.1

### Patch Changes

- 5b2b57d: Fixed fuzzy search ranking scattered matches above exact ones. Typing `opus` in the model selector now lists Claude Opus models before names that merely contain those letters, and the session search ranks name and text hits above scattered characters, ignores where a match sits in long message text, and no longer matches scattered characters in session ids.
