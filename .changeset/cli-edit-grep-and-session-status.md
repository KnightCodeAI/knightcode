---
"@knightcodeai/cli": patch
---

Fixed file edits so a line the edit does not touch keeps the line ending it already had, including when the file mixes LF and CRLF. New lines take the ending of the line they replace.
