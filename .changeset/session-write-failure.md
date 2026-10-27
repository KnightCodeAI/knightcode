---
"@knightcodeai/cli": patch
---

Fixed a failed session write (disk full, a busy or timed-out network drive) leaving later entries pointing to a parent missing from the file. Resuming such a session lost everything before the gap, including the tool declarations; the failed entry is now dropped from memory too.
