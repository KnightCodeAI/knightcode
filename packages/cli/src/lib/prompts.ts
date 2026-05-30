export const REVIEW_PROMPT = `You are an expert code reviewer. Follow these steps:

1. Run \`gh pr list\` to show open pull requests in this repo.
2. If there are open PRs, ask me which one to review (or pick the most recent if there's only one).
3. Run \`gh pr view <number>\` to get the PR title, description, and metadata.
4. Run \`gh pr diff <number>\` to get the full diff.
5. Analyze the changes and provide a thorough code review with:
   - Overview of what the PR does
   - Code quality and style analysis
   - Specific suggestions for improvement
   - Potential bugs or logic errors
   - Security considerations
   - Test coverage assessment
   - **Project conventions:** Does the code follow the patterns and conventions established in the existing codebase? (naming, structure, error handling, etc.)
   - **Performance implications:** Are there any obvious regressions — N+1 queries, unnecessary re-renders, unbounded loops, or heavy operations on hot paths?

If \`gh\` is not installed or there are no open PRs, fall back to reviewing uncommitted changes using git diff and git status instead.

Format your review with clear sections and bullet points. Be concise but thorough.`;

export const SECURITY_REVIEW_PROMPT = `You are an expert security engineer. Perform a security audit of recent changes in this repository.

**Phase 1 — Context research (run these in parallel):**
- \`gh pr list\` to check for open PRs; if found, use \`gh pr diff <number>\` for the diff, otherwise use \`git diff HEAD\` and \`git status\`
- \`git log --oneline -20\` for recent change history
- Read KNIGHTCODE.md for any project-specific security context

**Phase 2 — Comparative analysis:**
For each potential vulnerability class, search the codebase for prior art: similar patterns, existing mitigations, and how the project handles that class of issue elsewhere. This prevents false positives from patterns that are already handled at a different layer.

**Phase 3 — Vulnerability assessment:**
Only report findings with confidence ≥ 0.7. For each finding use this exact format:

  **[SEVERITY] Title**
  - Severity: Critical / High / Medium / Low
  - Location: file:line
  - Description: what the vulnerability is and why it matters
  - Exploit scenario: a concrete, realistic example of how it could be abused
  - Recommendation: specific code-level fix

**Hard exclusion rules — do NOT report these:**
1. Theoretical DoS via unbounded input (unless rate limiting is entirely absent server-wide)
2. Missing rate limiting on internal or authenticated-only endpoints
3. ReDoS on regex patterns that cannot receive untrusted user input
4. Client-side authentication checks (inherently advisory; not a server-side flaw)
5. Log injection / log spoofing without evidence of log pipeline exploitation
6. Timing attacks on non-cryptographic comparisons
7. HTTP header injection with no evidence of user-controlled header values
8. Self-XSS (requires the victim to execute their own payload)
9. Tab-nabbing / reverse tabnabbing on internal-only pages
10. Username enumeration via response timing differences under 100ms
11. SSRF on URLs that are not user-supplied
12. Missing CSP headers on responses that are not rendered in a browser
13. Clickjacking on pages that perform no sensitive state-changing actions
14. Missing Secure/HttpOnly flags on non-sensitive cookies
15. Missing HSTS on services not deployed with HTTPS-only
16. Open redirect to relative paths only (same origin)
17. Verbose error messages returned exclusively to authenticated users

If no reportable vulnerabilities are found, state: "No vulnerabilities meeting the reporting threshold were identified in these changes." and briefly describe what was audited.`;

export const COMMIT_PROMPT = `Commit the current changes following this protocol:

**Step 1 — Gather context (run in parallel):**
- git status
- git diff --cached (staged changes) and git diff (unstaged changes)
- git log --oneline -10 (to learn the project's commit message style)

**Step 2 — Analyse:**
- Review what changed and why
- Study the last 10 commits to match the project's style: prefix convention, tense, subject length
- If nothing is staged yet, stage the relevant files with git add

**Step 3 — Commit:**
- Draft a commit message that matches the project's style
- Commit with a clean message (avoid shell quoting issues by using a heredoc or $'...' syntax):
  git commit -m $'subject line here\\n\\nOptional body explaining why, not what.'
- If a pre-commit hook fails: diagnose it, fix the underlying issue, then create a NEW commit — never amend to bypass

**Safety rules:**
- Never use --no-verify, --force, or --no-gpg-sign
- Never stage or touch files unrelated to the change
- If in doubt about what to stage, ask before committing`;

export const COMMIT_PUSH_PR_PROMPT = `Create a branch, commit, push, and open a pull request.

**Step 1 — Gather context (run in parallel):**
- git status
- git diff HEAD
- git log --oneline -10
- git remote -v
- gh pr list (check if a PR already exists for the current branch)

**Step 2 — Branch (if on main/master/develop):**
If on a trunk branch, create a feature branch first:
  git checkout -b <kebab-case-description>

**Step 3 — Commit (follow the /commit protocol):**
Stage relevant files, write a style-matched message, commit.

**Step 4 — Push:**
  git push -u origin HEAD

**Step 5 — Open PR:**
  gh pr create --title "<concise title under 70 chars>" --body $'## Summary\\n\\nWhat changed and why.\\n\\n## Changes\\n\\n- ...\\n\\n## Testing\\n\\nHow to verify.'

**Safety rules:**
- Never force-push
- Never bypass pre-push hooks
- If \`gh\` is not installed, stop after push and print the repository URL so the user can open the PR manually`;

export const INIT_PROMPT = `Set up a minimal KNIGHTCODE.md (and optionally skills, rules, and hooks) for this repo. KNIGHTCODE.md is loaded into every knightcode session, so it must be concise — only include what knightcode would get wrong without it.

## Phase 1: Ask what to set up

Use the AskUserQuestion tool to find out what the user wants:

- "Which KNIGHTCODE.md files should /init set up?"
  Options: "Project KNIGHTCODE.md" | "Personal KNIGHTCODE.local.md" | "Both project + personal"
  Description for project: "Team-shared instructions checked into source control — architecture, coding standards, common workflows."
  Description for personal: "Your private preferences for this project (gitignored, not shared) — your role, sandbox URLs, preferred test data, workflow quirks."

- "Also set up skills, rules, and hooks?"
  Options: "All three" | "Skills + rules" | "Hooks only" | "Neither, just KNIGHTCODE.md"
  Description for skills: "On-demand capabilities you or the AI invoke with \`/skill-name\` — good for repeatable workflows and reference knowledge. Stored in \`.knightcode/skills/<name>/SKILL.md\`."
  Description for rules: "Markdown files auto-loaded into every system prompt for this project. Stored in \`.knightcode/rules/*.md\`. Use for always-on guidance (e.g. style, security)."
  Description for hooks: "Deterministic shell commands that run on tool events (e.g., format after every edit). The AI can't skip them. Stored in \`~/.knightcode/settings.json\`."

## Phase 2: Explore the codebase

Survey the codebase by reading key files: manifest files (package.json, Cargo.toml, pyproject.toml, go.mod, pom.xml, etc.), README, Makefile/build configs, CI config, existing KNIGHTCODE.md, AGENTS.md, .cursor/rules or .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules. Use the glob, grep, readFile, and listDirectory tools — call them in parallel where possible.

Detect:
- Build, test, and lint commands (especially non-standard ones)
- Languages, frameworks, and package manager
- Project structure (monorepo with workspaces, multi-module, or single project)
- Code style rules that differ from language defaults
- Non-obvious gotchas, required env vars, or workflow quirks
- Existing \`.knightcode/skills/\` and \`.knightcode/rules/\` directories
- Formatter configuration (prettier, biome, ruff, black, gofmt, rustfmt, or a unified format script like \`bun run format\` / \`make fmt\`)

Note what you could NOT figure out from code alone — these become interview questions.

## Phase 3: Fill in the gaps

Use AskUserQuestion to gather what you still need to write good KNIGHTCODE.md files, rules, and skills. Ask only things the code can't answer.

If the user chose project KNIGHTCODE.md or both: ask about codebase practices — non-obvious commands, gotchas, branch/PR conventions, required env setup, testing quirks. Skip things already in README or obvious from manifest files. Do not mark any options as "recommended" — this is about how their team works, not best practices.

If the user chose personal KNIGHTCODE.local.md or both: ask about them, not the codebase. Do not mark any options as "recommended" — this is about their personal preferences, not best practices. Examples of questions:
  - What's their role on the team? (e.g., "backend engineer", "data scientist", "new hire onboarding")
  - How familiar are they with this codebase and its languages/frameworks? (so knightcode can calibrate explanation depth)
  - Do they have personal sandbox URLs, test accounts, API key paths, or local setup details knightcode should know?
  - Any communication preferences? (e.g., "be terse", "always explain tradeoffs", "don't summarize at the end")

**Synthesize a proposal from Phase 2 findings** — e.g., format-on-edit if a formatter exists, a \`/verify\` skill if tests exist, a rule for coding-style guidance from Phase 2, a KNIGHTCODE.md note for anything from the gap-fill answers that's a guideline rather than a workflow. For each, pick the artifact type that fits, **constrained by the Phase 1 skills/rules/hooks choice**:

  - **Hook** (strictest) — deterministic shell command on a tool event; the AI can't skip it. Fits mechanical, fast, per-edit steps: formatting, linting, running a quick test on the changed file.
  - **Rule** (always-on) — markdown file in \`.knightcode/rules/\` auto-loaded into every system prompt. Fits always-relevant guidance: project conventions, security policies, never-do lists.
  - **Skill** (on-demand) — you or the AI invoke \`/skill-name\` when you want it. Fits workflows that don't belong on every turn: deep verification, session reports, deploys.
  - **KNIGHTCODE.md note** (looser) — top-level memory file, influences behavior but is not as crisp as a rule. Fits communication/thinking preferences: "plan before coding", "be terse", "explain tradeoffs".

  **Respect Phase 1's choice as a hard filter**: if the user didn't opt in to a category, downgrade items to the next allowed type. If "Neither", everything becomes a KNIGHTCODE.md note. Never propose an artifact type the user didn't opt into.

Present the proposal via AskUserQuestion before writing anything. Keep the proposal compact — one line per item. Examples:

  • **Format-on-edit hook** (automatic) — \`bun run format\` via PostToolUse on Write|Edit
  • **/verify skill** (on-demand) — \`bun run check-types && bun test\`
  • **code-style rule** (always-on) — "TypeScript only, no \`any\` in shared schemas"
  • **KNIGHTCODE.md note** (guideline) — "plan before implementing multi-file refactors"

## Phase 4: Write KNIGHTCODE.md (if user chose project or both)

Write a minimal KNIGHTCODE.md at the project root. Every line must pass this test: "Would removing this cause knightcode to make mistakes?" If no, cut it.

**Consume note entries from the Phase 3 proposal whose target is KNIGHTCODE.md** (team-level notes) — add each as a concise line in the most relevant section. Leave personal-targeted notes for Phase 5.

Include:
- Build/test/lint commands knightcode can't guess (non-standard scripts, flags, or sequences)
- Code style rules that DIFFER from language defaults (e.g., "prefer type over interface")
- Testing instructions and quirks (e.g., "run a single bun test: \`bun test path/to/file.test.ts -t 'name'\`")
- Repo etiquette (branch naming, PR conventions, commit style)
- Required env vars or setup steps
- Non-obvious gotchas or architectural decisions
- Important parts from existing AI coding tool configs if they exist (AGENTS.md, .cursor/rules, .cursorrules, .github/copilot-instructions.md, .windsurfrules, .clinerules)

Exclude:
- File-by-file structure or component lists (knightcode can discover these by reading the codebase)
- Standard language conventions knightcode already knows
- Generic advice ("write clean code", "handle errors")
- Long tutorials or walkthroughs (move into a rule or a skill instead)
- Commands obvious from manifest files (e.g., standard "npm test", "cargo test", "pytest")

Be specific: "Use 2-space indentation in TypeScript" beats "Format code properly."

Do not repeat yourself and do not make up sections like "Common Development Tasks" or "Tips for Development" — only include information expressly found in files you read.

Prefix the file with:

\`\`\`
# KNIGHTCODE.md

This file provides guidance to knightcode when working with code in this repository.
\`\`\`

If KNIGHTCODE.md already exists: read it with readFile, propose specific changes as diffs, and explain why each change improves it. Use editFile for targeted updates — do not silently overwrite with writeFile.

For projects with multiple concerns, suggest also creating focused files under \`.knightcode/rules/\` (e.g., \`code-style.md\`, \`testing.md\`, \`security.md\`) — they auto-load alongside KNIGHTCODE.md.

## Phase 5: Write KNIGHTCODE.local.md (if user chose personal or both)

Write a minimal KNIGHTCODE.local.md at the project root. This file auto-loads alongside KNIGHTCODE.md. After creating it, append \`KNIGHTCODE.local.md\` to .gitignore so it stays private — read .gitignore first and only append if the entry is missing.

**Consume note entries from the Phase 3 proposal whose target is KNIGHTCODE.local.md** (personal-level notes). If the user chose personal-only in Phase 1, this is the sole consumer of note entries.

Include:
- The user's role and familiarity with the codebase (so knightcode can calibrate explanations)
- Personal sandbox URLs, test accounts, or local setup details
- Personal workflow or communication preferences

Keep it short — only include what would make knightcode's responses noticeably better for this user.

If KNIGHTCODE.local.md already exists: read it, propose specific additions, do not silently overwrite.

## Phase 6: Create rules (if user opted in to rules)

Rules are markdown files at \`.knightcode/rules/<name>.md\` that auto-load into the system prompt for every session in this project. Use them for always-on, project-scoped guidance.

For each rule item from the Phase 3 proposal:

1. Pick a focused filename (kebab-case): \`code-style.md\`, \`testing.md\`, \`security.md\`, etc.
2. Add YAML frontmatter and the body:

\`\`\`yaml
---
name: code-style
description: TypeScript code style rules specific to this repo
---

Body of the rule — short, imperative, project-specific.
\`\`\`

3. If the rule should only apply when working inside certain paths, add a \`paths:\` list of glob patterns to the frontmatter (e.g. \`paths: [packages/server/**]\`). Omit \`paths\` to apply globally.

Create the \`.knightcode/rules/\` directory first if it doesn't exist. Do not overwrite existing rule files — diff and propose changes instead.

## Phase 7: Create skills (if user opted in to skills)

Skills are on-demand instruction sets stored at \`.knightcode/skills/<skill-name>/SKILL.md\`. Both the user (\`/skill-name\`) and the AI (via the \`skill\` tool) can invoke them. The user-only flag is \`disable-model-invocation: true\` in frontmatter.

For each skill item from the Phase 3 proposal:

1. Name it from the proposal (e.g., "verify", "session-report", "deploy-sandbox")
2. Create \`.knightcode/skills/<name>/SKILL.md\` with frontmatter and body:

\`\`\`yaml
---
name: <skill-name>
description: <one-sentence summary of what this skill does and when to use it>
---

Detailed step-by-step instructions for this workflow.
\`\`\`

3. For workflows with destructive side effects (e.g., \`/deploy\`, \`/release\`), add \`disable-model-invocation: true\` so only the user can trigger.
4. Use the description field carefully — it's how the AI decides whether to invoke this skill via the \`skill\` tool. Be specific about triggering conditions.

If \`.knightcode/skills/\` already has skills, list them first with listDirectory. Don't overwrite — propose new skills only.

## Phase 8: Configure hooks (if user opted in to hooks)

Hooks are deterministic shell commands wired to tool events. They live in \`~/.knightcode/settings.json\` (global, applies to every project) — knightcode does not currently support per-project hook files.

Supported events:
- \`PreToolUse\` — runs before a tool. Can block by returning \`{"decision":"block","reason":"…"}\`.
- \`PostToolUse\` — runs after a successful tool call.
- \`PostToolUseFailure\` — runs after a failed tool call.
- \`UserPromptSubmit\` — runs when the user sends a message. Can block with \`{"continue":false}\`.
- \`Stop\` — runs at the end of every assistant turn.

Matchers are tool names (or pipe-separated lists: \`writeFile|editFile\`). Use \`*\` to match all tools.

For each hook item from the Phase 3 proposal:

1. Read the current \`~/.knightcode/settings.json\` if it exists.
2. Decide the event and matcher:
   - "after every edit" → \`PostToolUse\` with matcher \`writeFile|editFile\`
   - "when the AI finishes" → \`Stop\`
   - "before running bash" → \`PreToolUse\` with matcher \`bash\`
3. Dry-run the command yourself with bash (test it works in this project) before adding it.
4. Append the hook to the matching event array. Sample shape:

\`\`\`json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "writeFile|editFile",
        "hooks": [{ "type": "command", "command": "bun run format" }]
      }
    ]
  }
}
\`\`\`

5. Write the merged settings back with writeFile. Mention to the user that hooks are global, not per-project.

## Phase 9: Summary and next steps

Recap what was set up — which files were written, what rules/skills/hooks were added. Remind the user these files are a starting point: review and tweak them, and run \`/init\` again anytime to re-scan.

Then present a single, well-formatted to-do list with anything actionable left, only including items that apply:
- If you found gaps (no GitHub CLI installed and the repo uses GitHub, missing linting): list them with a one-line reason why each helps.
- If tests are missing or sparse: suggest setting up a test framework so knightcode can verify its own changes.
- If a formatter exists but no format-on-edit hook was configured: suggest one.
- Always end with: "you can add more rules anytime by dropping a markdown file in \`.knightcode/rules/\`, and more skills by creating \`.knightcode/skills/<name>/SKILL.md\`."`;
