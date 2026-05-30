import type { Skill } from "../../skills";

const SIMPLIFY_BODY = `# Simplify: Code Review and Cleanup

Review all changed files for code reuse, quality, and efficiency. Fix any issues found.

## Phase 1: Identify Changes

Run \`git diff\` (or \`git diff HEAD\` if there are staged changes) to see what has changed. If there are no git changes, review the most recently modified files that the user mentioned or that you edited earlier in this conversation.

## Phase 2: Review Categories

Analyze the diff and changed files across three categories:

### 1. Code Reuse Review
* **Search for existing utilities and helpers** that could replace newly written code. Look for similar patterns elsewhere in the codebase.
* **Flag any new function that duplicates existing functionality.** Suggest using the existing function instead.
* **Flag any inline logic that could use an existing utility** — hand-rolled string manipulation, manual path handling, custom environment checks, ad-hoc type guards, and similar patterns.

### 2. Code Quality Review
* **Redundant state**: state that duplicates existing state, cached values that could be derived, observers/effects that could be direct calls.
* **Parameter sprawl**: adding new parameters to a function instead of generalizing or restructuring existing ones.
* **Copy-paste with variation**: near-duplicate code blocks that should be unified with a shared abstraction.
* **Leaky abstractions**: exposing internal details that should be encapsulated, or breaking existing boundaries.
* **Stringly-typed code**: using raw strings where constants, enums (string unions), or branded types already exist in the codebase.
* **Unnecessary comments**: comments explaining WHAT the code does (well-named identifiers already do that) — delete; keep only non-obvious WHY (hidden constraints, subtle invariants, workarounds).

### 3. Efficiency Review
* **Unnecessary work**: redundant computations, repeated file reads, duplicate network/API calls, N+1 patterns.
* **Missed concurrency**: independent operations run sequentially when they could run in parallel.
* **Hot-path bloat**: new blocking work added to startup or per-request/per-render hot paths.
* **Unnecessary existence checks**: pre-checking file/resource existence before operating (TOCTOU anti-pattern) — operate directly and handle the error.
* **Memory**: unbounded data structures, missing cleanup, event listener leaks.

## Phase 3: Fix Issues

Aggregate your findings and fix each issue directly. If a finding is a false positive or not worth addressing, note it and move on.

When done, briefly summarize what was fixed (or confirm the code was already clean).
`;

export const simplifySkill: Skill = {
  name: "simplify",
  description:
    "Review changed code for reuse, quality, and efficiency, then fix any issues found.",
  userInvocable: true,
  disableModelInvocation: false,
  source: "bundled",
  dirPath: "",
  body: SIMPLIFY_BODY,
};
