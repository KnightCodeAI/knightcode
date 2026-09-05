---
"@knightcodeai/cli": minor
---

Changed the agent engine to a lane-owned durable architecture, rebuilding the harness, session, protocol, client and server layers in one pass.
  - Added `@knightcode/chord`, the application composition runtime (services, replicated state, RPC, plugins) the harness, protocol, client and server now build on.
  - Changed the harness runtime to a lane-owned drive: durable execution primitives, an effect gate, hooks, restore, and a mutation line replace the earlier operation-task/procedure runtime, and the transitional `runtime2` and `restore` layers are gone.
  - Changed the session layer to bound values and lists with a commit/fork/mutation-line model, storage and repository conformance suites, and session benchmarks; the SQLite backend follows it.
  - Changed the protocol, client and server to Chord-routed services: a single `protocol.ts`, a hosted harness manager, server identities, session directories, draining, and the wrong-server/session-not-found error set replace the earlier RPC schemas and live-session manager.
  - Changed the experimental CLI to durable server and client commands, with `--provider`, `--model`, `-e`, `--continue`, `--resume`, `--server-id` and `--session-dir`, dropping the local demo runtime and session-worker process.
  - Changed built-in tool rendering to load from `core/tools/renderers/`, so a process that only displays tool output no longer pulls in the execution path; the KnightCode tool-output style (`Read(...)`, `Search(...)`, `Update(...)`, collapsed one-line summaries) moved with it.
  - Added click-to-expand on tool results, wired through the gutter shell so the bullet and continuation-marker layout keeps working.
  - Fixed the reserved fork namespace guard, which tested for a stale prefix and so never matched a `knightcode.` namespace.
  - Fixed Windows portability across the session, socket and CLI-spawning suites: `node --import` now receives a file URL, session tests resolve their workspace paths, and the Unix-socket suites are skipped where the platform cannot bind them.
