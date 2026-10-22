---
"@knightcodeai/cli": patch
---

Fixed the HTML export header's total cost to add up each message's recorded total, so a total billed by the provider is shown rather than a sum of catalog estimates. Sessions recorded before totals were stored still fall back to the sum of the parts.
