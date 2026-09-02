---
"@knightcodeai/cli": patch
---

Match `NO_PROXY` entries against the root domain and its subdomains, and parse
IPv6 hosts and `host:port` entries correctly, so a bare `example.com` entry
also bypasses the proxy for `api.example.com` and `notexample.com` no longer
matches it. A bare `*` entry now bypasses everything even when listed
alongside other entries, and an entry with a malformed port is dropped rather
than widened into a host-wide bypass.
