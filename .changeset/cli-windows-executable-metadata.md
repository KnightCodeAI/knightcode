---
"@knightcodeai/cli": patch
---

Fixed the compiled Windows executable inheriting Bun's own PE resources, so `knightcode.exe` shipped with no icon and a `FileDescription` of "Bun" — the string Windows shows as the process name in Task Manager and the taskbar. The win32 build now embeds KnightCode's own title, publisher, copyright, version, and icon.
