---
"@knightcodeai/cli": patch
---

Fixed `tool_search` and code mode's `searchTools()` ranking a tool first because one query word is its name, above a tool whose description matches more of the query: `screenshot window` returned a `window` tool instead of the screenshot tool, and `describe app` an `app` tool instead of the one that describes an app's UI. A tool that matches more of the query's words now ranks first; among tools matching as many words the name still counts most, and a query that is exactly a tool's name still finds that tool first.
