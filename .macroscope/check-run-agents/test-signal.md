---
title: Test Signal
model: gpt-6-1-terra
reasoning: low
input: incremental
tools:
  - browse_code
  - modify_pr
# An explicit include overrides ignore.md, which skips test files for every other check.
include:
  - "**/*.test.*"
exclude:
  - "**/fixtures/**"
# Wait for the type check to pass before spending a run on a broken PR.
requires:
  - build-check
maxBudgetPerRun: 1
maxBudgetPerPR: 5
conclusion: neutral
showToolCalls: true
---

# Test signal review

Review only the tests this pull request adds or grows. Tests it moves, renames, or deletes are not findings. The repository's testing rules are in `AGENTS.md` under `## Commands`; read that section first.

Hold new tests to these rules:

- A test checks behavior a user or caller can see, not private helpers or the exact shape of internal calls.
- A new case extends the closest existing test file and `describe` block instead of starting a parallel one.
- A test stays at one layer: unit tests do not boot the app server or spawn shells when a direct call covers the same behavior.
- No near-duplicate cases that differ only in a literal and assert the same branch.
- No live provider endpoints, API keys, or paid tokens unless the test is gated on that credential's env var (`it.skipIf(!process.env.X_API_KEY)`). `packages/cli/test/suite/` tests use the faux provider through `test/suite/harness.ts`.
- No fixed sleeps where an event or condition can be awaited.

Post each finding as a brief inline comment on the new test with one fix. Ask only for fewer, smaller, or sturdier tests, never for more coverage.

When there are no findings, make the entire final response exactly `All clear` on one line with nothing else.
