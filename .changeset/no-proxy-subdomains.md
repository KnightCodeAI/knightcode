---
"@knightcodeai/cli": patch
---

Match `NO_PROXY` entries against the root domain and its subdomains, and parse
IPv6 hosts and `host:port` entries correctly, so a bare `example.com` entry
also bypasses the proxy for `api.example.com` and `notexample.com` no longer
matches it.
