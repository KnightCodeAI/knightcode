# Phase B (workspaces, diffs, git): implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status (2026-10-18):** v14, final; the review rated it ready (round 20: no blocker or major finding). Nothing implemented. v14 makes every user-visible behaviour match the Codex desktop app: it was checked by driving the app (ChatGPT for Windows, Codex mode) in a throwaway repository and by reading Codex's open-source worktree crate (`shenanigans/codex/codex-rs/worktree`) and its documentation. "Codex parity" below lists each decision and what it rests on. The twelve review rounds of v1-v13 are summarized at the end.

**Goal:** Give app server threads a workspace (the user's checkout, or a git worktree of their own), a reviewable diff, the git actions a review pane needs, and Codex's handoff that moves a chat and its changes between the worktree and the user's checkout, all over the protocol, without touching the harness.

**Architecture:** Three new modules under `packages/cli/src/app-server/`: `git.ts` (one way to run git and other tools: scrubbed environment, literal pathspecs, argument arrays, process groups, a per-repository mutation queue, the temporary-index snapshot, one machine-patch helper), `workspaces.ts` (worktree manifests, creation, environments, handoff, deletion with snapshots, restore) and `diff.ts` (scoped diffs, hunks, revert, review comments, turn change detection), plus `git-actions.ts` for the `git/*` methods. A worktree is described by a manifest file the server writes beside it. A thread's workspace is derived from its session cwd and, for a thread that was handed off, from the manifest's `placement` record, so every path that creates or loads a session (start, fork, resume, extension replacements) gets it right without extra bookkeeping. `threads.ts` calls the modules at the points it already owns: start, fork, load, archive, settle, dispose. Every method is a vertical slice: TypeBox schema, server code, a test through the in-process client against a real temporary git repository.

**Tech Stack:** TypeScript on Bun 1.3, TypeBox, Vitest, the faux provider, the `git` executable (2.31 or later), `gh` for pull requests.

**Spec:** `apps/desktop/docs/desktop-app/architecture.md` section 6 (as revised in this plan's branch), 4.4, 4.7, 5.6, 5.8, 11, 13. Section numbers below (§) refer to architecture.md. Codex observations are in this plan's "Codex parity" table; the raw notes of the 2026-10-17 session are not part of the repository.

## Execution progress

Progress is tracked in `.superpowers/sdd/phase-b-plan/progress.md`. No commits are authorized by this plan; a task is complete when its selected tests and the root type check pass.

- [ ] Task 0 — process and git runner, snapshots, machine patches, test fixture
- [ ] Task 1 — Phase B protocol schemas
- [ ] Task 2 — worktree settings, manifests and worktree threads: create, list, resume
- [ ] Task 3 — environments, `.worktreeinclude`, setup and progress
- [ ] Task 4 — fork into the same workspace or a new worktree
- [ ] Task 5 — `thread/diff/read` with scopes
- [ ] Task 6 — turn change detection and `turn/diff/updated`
- [ ] Task 7 — `thread/diff/revert` and review comments on `turn/start`
- [ ] Task 8 — `git/*`: status, stage, unstage, commit, push, pull request, branches, log
- [ ] Task 9 — `thread/handoff` between the worktree and the main checkout
- [ ] Task 10 — worktree deletion with snapshots, pruning, restore, `worktree/list` and `worktree/delete`
- [ ] Task 11 — docs, changeset, schema and validation

## Global Constraints

- **Harness boundary (§4.7).** No edit to `packages/agent`, `packages/ai`, or `packages/cli/src/core`. Every change lives in `packages/cli/src/app-server/`, `packages/app-server-protocol/`, tests and docs. A task that seems to need a harness change stops and reports why the server cannot do it. Public harness API the plan relies on: `SessionManager.create(cwd, dir, {id})`, `SessionManager.open(path, dir, cwdOverride)` (`session-manager.ts:1904`), `SessionManager.forkFrom(path, cwd, dir, {id, leafId})`, `appendCustomEntry`, `getBranch`, `getCwd`, `AgentSession.resourceLoader.getExtensions().runtime` (the virtual-model owner, `agent-session.ts:581`), `ModelRuntime.completeSimple(model, context, options, owner)` (`model-runtime.ts:750`), `getShellConfig()` (`utils/shell.ts`).
- Formatting is Prettier: tabs, 120 columns, LF. No `any`. No inline imports. `erasableSyntaxOnly`: explicit fields assigned in constructors.
- `packages/app-server-protocol/src` imports nothing from `@knightcode/ai` or `@knightcode/agent`.
- No `exec(`, `execSync(` or `shell: true` under `packages/cli/src/app-server`. Every child process (git, `gh`, setup and cleanup scripts) goes through `runProcess` in `git.ts`, so the environment scrub, the process group and the kill-and-wait cannot be forgotten.
- Every git pathspec is literal (`GIT_LITERAL_PATHSPECS=1` on every call): a client-selected `a[1].txt` never matches `a1.txt` (probed 2026-10-17). Paths a client names are accepted only when they appear in the diff the server just computed, or (for `git/stage`/`git/unstage` by path) in `git status` output; never as free pathspecs.
- Windows and POSIX: `node:path` for joins; git prints `/`-separated paths relative to the repository root, so they are joined, never concatenated; `-z` output wherever paths are parsed; `-c core.quotepath=false` on every call; environment names compared case-insensitively on win32.
- Tests never touch the real `~/.knightcode` or a real repository: `startServer()` gives temp `agentDir`, `sessionDir` and `cwd`, and Task 0's `makeRepo()` turns the temp `cwd` into a git repository with a local identity, signing off and `core.autocrlf=false` (the CRLF test sets it on explicitly). Faux provider only.
- Race tests never sleep a fixed time. They wait on a gate (`createGate`, `createHeldTurn`, the `hooks` objects named in Tasks 2, 6, 9 and 10) or a notification (`waitFor`), and release gates in `finally`.
- "The user's checkout is unchanged" means `expect(checkoutState(dir)).toEqual(before)` (Task 0): HEAD, every index entry with its stage (so an unresolved index is representable), `git status` output, the bytes of every changed, untracked and ignored file (symlinks by target), and the contents of `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `AUTO_MERGE` and the `rebase-merge`/`rebase-apply` directories' presence.
- Each task adds its protocol pieces to `packages/app-server-protocol/test/protocol.test.ts` (one valid example per message; the coverage test fails without one) and regenerates `packages/cli/docs/app-server.schema.json` (`cd packages/app-server-protocol && bun run generate:schema`).
- After code changes: `bun run check-types` from the repo root, full output, zero errors before a task is done. Tests run from the package root: `cd packages/cli && bun x vitest --run test/app-server/<file>`.
- Commits only when the user authorizes them. Format `{feat,fix,docs,refactor,chore}(cli): <message>`; no `Co-Authored-By` trailer; explicit paths only.

## Review Focus

The inputs most likely to hurt a user if a task gets them wrong:

1. **Handoff** (Task 9): the destination checkout must be completely clean (nothing staged, no tracked change, no untracked file that is not ignored; ignored files are fine), as Codex requires ("Stash or commit your local changes to hand off"), and no merge, rebase, cherry-pick or revert may be in progress in either checkout. The moved changes leave the source only after they were applied in the destination; a failure in between leaves them in the source and in a saved patch, never nowhere.
2. **Inherited git environment** (Task 0): a server started from a git hook or another repository's shell has `GIT_DIR`, `GIT_INDEX_FILE` or `GIT_WORK_TREE` set, on Windows in any letter case. Unscrubbed, a snapshot writes the user's real index or another repository.
3. **The user's index during snapshots** (Tasks 0, 5, 6): every snapshot and index tree uses a temporary copy; the real index file is never written. `assume-unchanged` flags are cleared in the copy so a flagged edit is still seen.
4. **Deleting a worktree** (Task 10): only after its snapshot commit is referenced (`refs/knightcode/snapshots/<bucket>`) and recorded in the manifest; never while a thread is loaded or loading in it or a checkout reservation holds it; only registrations in the managed layout; no repository-wide `git worktree prune`. Ignored files (installed dependencies, `.env` copies) are not in the snapshot, as in Codex.
5. **Revert and stage** (Tasks 7, 8): literal paths only; a hunk that changed since it was read is refused (`diffChanged`); "undo the turn" refuses unless every affected file still has exactly the content the turn left, so git's offset search can never pick another place.

## Codex parity

Every row is applied to architecture.md section 6 in this plan's branch; tasks implement the revised text. "Observed" means seen in the Codex app on 2026-10-17; "crate" means `codex-rs/worktree`; "docs" means Codex's published worktree and local-environment pages.

| Behaviour | Codex evidence | Replaces (v13) |
| --- | --- | --- |
| A new worktree is a detached `HEAD` at the selected branch's tip; no branch exists until "Create branch here" (`git/branch/create`) or a handoff | Docs: "The worktree isn't checked out as a branch. It's in a detached HEAD state."; observed; crate `worktree add --detach` | A `kc/<threadId>` branch per worktree |
| Layout `<root>/<bucket>/<repoName>`, `bucket` = 4 random hex digits, `root` = `worktrees.root` or `<agentDir>/worktrees`; the manifest is `<root>/<bucket>/worktree.json` | Crate `has_managed_layout` and `allocate_worktree_root`; observed `~/.codex/worktrees/dcc4/codex-verify`; the bucket outlives a deleted checkout (observed), which keeps the manifest for restore | `<projectKey>/<idTail>/<repoName>` |
| The checkout is populated with hooks, fsmonitor and every configured filter disabled and `GIT_LFS_SKIP_SMUDGE=1`, so no user code runs while a worktree is made and creation rolls back completely on failure | Crate `git_output(WorkingTree)` empties `filter.<name>.clean/smudge/process`; `worktree add --no-checkout` then `reset --hard` | A retention boundary at the populate step |
| `carryLocalChanges` applies the checkout's uncommitted changes (untracked included, ignored excluded) to the new worktree as uncommitted edits | Docs: "If you chose a branch with local changes, Codex applies the uncommitted changes to the worktree as well." | A snapshot commit as the base |
| Ignored files to copy are listed in `.worktreeinclude` (gitignore syntax) at the repository root | Docs | The `worktree.include` setting |
| Environments live in the project at `.knightcode/environments.json` (committable): a name, a setup script and a cleanup script, each with `default`, `macos`, `linux` and `windows` variants, and actions; a worktree start picks one or none | Observed "Configure local environment" (New worktree, Branch, Environment: "Work without environment" or a project's environment) and Settings > Worktrees > Environments ("Edit local environment"); docs: stored in the project's `.codex` folder and can be committed | The `worktree.setup` setting |
| The setup script runs at the project root on worktree creation, with `KNIGHTCODE_SOURCE_TREE_PATH` and `KNIGHTCODE_WORKTREE_PATH`; the cleanup script runs at the project root before the worktree is deleted, with the same variables | Observed: "Runs at the project root on worktree creation", "Runs at the project root before worktree cleanup", variables `CODEX_SOURCE_TREE_PATH` ("Source workspace path") and `CODEX_WORKTREE_PATH` ("New worktree path") | Setup in the worktree with `KNIGHTCODE_PROJECT_DIR`; no cleanup script |
| Archiving a thread deletes its worktree; past `worktrees.keep` (default 15) the least recently used worktrees are pruned; every deletion first commits a snapshot of the worktree (uncommitted and untracked files, and the staged state as a second parent) with `HEAD` as its first parent and keeps it under its own ref; `worktrees.autoDelete: false` turns both off; `worktree/delete` deletes one by hand | Docs: archive deletes, keep 15, "Codex saves a snapshot of the work on it"; observed settings ("Automatically delete old worktrees", "Auto-delete limit", per-worktree Delete) and the ref `refs/codex/snapshots/<id>` holding "Codex worktree snapshot: archive-cleanup" | Never deleted automatically; `thread/archive {removeWorktree}` |
| A thread whose worktree was deleted answers `worktreeDeleted` on resume; `thread/worktree/restore` rebuilds the worktree from its snapshot, uncommitted edits back as uncommitted | Docs: on reopening the chat "you'll see the option to restore it" | Re-adding the worktree from its branch on resume |
| Fork: in the same workspace, or into a new worktree that carries the source's uncommitted changes | Observed dialog "Fork chat from here": "Fork in this worktree" and "Fork in a new worktree"; the new worktree had the source's uncommitted edit | A `local` fork mode; carrying optional |
| Handoff (`thread/handoff`): to the main checkout, refused unless it is clean; the worktree's `HEAD` becomes a branch (the worktree's own, else `<branchPrefix><title-slug>`, editable) checked out in the main checkout; the uncommitted changes move; the worktree is detached and kept; the chat runs in the main checkout from then on. Back to the worktree: the reverse, with the main checkout left on its branch | Observed "Move to main checkout" dialog ("Bring changes back to local checkout: Check out branch codex/change-two-to-two-in in a local workspace and detach it from worktree."), the refusal for a tracked edit and for an untracked file alone, and the result (branch created and checked out, edits moved, worktree left clean and detached, chat now local); docs: handoff works both ways and "each chat keeps its associated worktree" | `merge`/`apply` into a dirty checkout with pending records, quarantine and raw fingerprints |
| Diff scopes add `committed` (one commit, picked from `git/log`) and `branch` against a chosen branch; `ignoreWhitespace` on reads | Observed Changes source menu (Last Turn, Uncommitted, Unstaged, Staged, Committed, Branch; Branch shows "HEAD → Select branch") and options ("Hide white space") | Five scopes; `branch` only against `baseRef` |
| Review comments are drafts the client keeps and sends with the next `turn/start` or queued input; the user item shows them as structured comments | Observed: "Local comment on line R2", a "1 comment" chip on the composer, the sent turn's chip popover "a.txt R 2 <body>" | `thread/diff/comment` queuing a message at once |
| `git/commit` stages everything first unless `includeUnstaged: false`; branch create, switch and listing, and a commit log, are methods | Observed Commit dialog ("Include unstaged changes", checked by default; "leave blank to generate") and Git actions (Commit, Push, Create branch, Switch branch, Create pull request) | Staged-only commit; no branch methods |
| Worktree settings are the user's (`worktrees.root`, `autoDelete`, `keep`, `fetchBeforeCreate`, `branchPrefix`) in the global settings file | Crate settings `git-worktree-root`, `worktree-auto-cleanup-enabled`, `worktree-keep-count` (15); observed "Always fetch upstream before creating worktrees" (off by default); docs: branch prefix `codex/` | Per-project `worktree.*` settings |

Deliberately kept beyond Codex: the Last Turn diff is persisted in the transcript (Codex showed "The latest diffs are no longer available"), the server owns every git operation (Codex's desktop runs git itself; this renderer has no Node, and one queue per repository needs one owner), a thread in a repository subdirectory runs in the same subdirectory of its worktree (the crate does this too), and a worktree's trust is its project's. Not in Phase B: Codex's pinned chats and "permanent" worktrees (both exempt from pruning; added with pinning), the Actions toolbar and "Open terminal" (desktop shell S2 reads `actions` from the environment file), and rich preview, word diffs and hidden imports (client rendering).

## Task 0: Process and git runner, snapshots, machine patches, test fixture

**Files:**
- Create: `packages/cli/src/app-server/git.ts`
- Create: `packages/cli/test/app-server/fixtures/git-repo.ts`
- Test: `packages/cli/test/app-server/git.test.ts`

**Interfaces:**

```ts
// git.ts
export interface ProcessOptions {
	cwd: string;
	env?: Record<string, string>;
	input?: string | Buffer;
	/** Default 120 s. Expiry or abort kills the process group and waits for it to exit (at most 10 s more). */
	timeoutMs?: number;
	signal?: AbortSignal;
	/** Default 64 MiB. Exceeding it kills the process and throws OutputTooLarge. */
	maxStdoutBytes?: number;
	/** stderr kept in ProcessResult: the last `stderrTailBytes` (default 64 KiB), never all of it. */
	stderrTailBytes?: number;
	/** false: stdout goes only to `onStdout` and is not collected, so `maxStdoutBytes` does not apply (setup). */
	collectStdout?: boolean;
	/** Per stdout chunk; return false to stop and kill (bounded counts). */
	onStdout?: (chunk: Buffer) => boolean | void;
	onStderr?: (chunk: Buffer) => void;
}
export interface ProcessResult { code: number | null; stdout: Buffer; stderr: string }
export class ProcessKilled extends Error {} // timeout or abort; the process tree is confirmed gone
/** The tree could not be confirmed gone (taskkill failed, or the group outlived the wait). Callers keep their files. */
export class ProcessKillUnconfirmed extends Error {}
export class OutputTooLarge extends Error {}
/** Spawn with a scrubbed environment in its own process group; ENOENT becomes toolMissing naming `command`. */
export function runProcess(command: string, args: string[], options: ProcessOptions): Promise<ProcessResult>;
export function childEnv(extra?: Record<string, string>): NodeJS.ProcessEnv;

export interface GitOptions extends Omit<ProcessOptions, "cwd"> {
	/** Server bookkeeping (snapshots, worktree add/remove, handoff steps): hooks and fsmonitor off. */
	internal?: boolean;
	/** Worktree population (Tasks 2, 9, 10): every configured filter emptied and Git LFS smudging off, so no user code runs. */
	noFilters?: boolean;
}
export class GitError extends Error { readonly args: string[]; readonly code: number | null; readonly stderr: string }
export function runGit(cwd: string, args: string[], options?: GitOptions): Promise<ProcessResult>; // never throws on exit code
export function git(cwd: string, args: string[], options?: GitOptions): Promise<string>; // one trailing newline stripped; GitError on exit != 0

export interface Repo {
	root: string; // canonical checkout root
	gitDir: string; // this checkout's git dir (a linked worktree has its own)
	commonDir: string; // shared by every worktree of the repository
	prefix: string; // cwd relative to root, "/"-separated, "" at the root
}
export function repoOf(cwd: string): Promise<Repo | undefined>; // undefined outside a work tree
export function requireRepo(cwd: string): Promise<Repo>; // AppServerError("notGitRepo")
export function gitAtLeast(major: number, minor: number): Promise<boolean>;
export function withRepoLock<T>(repo: Repo, fn: () => Promise<T>): Promise<T>;
/** The empty tree in the repository's object format (SHA-1 or SHA-256): `git hash-object -t tree -w --stdin` with no
 * input, written so every later command finds the object; memoized per `commonDir`. The only empty-tree source. */
export function emptyTree(repo: Repo): Promise<string>;
export function headTree(repo: Repo): Promise<string>; // emptyTree(repo) on an unborn branch
export function indexTree(repo: Repo): Promise<string>;
export function snapshotTree(repo: Repo, untracked: boolean, signal?: AbortSignal): Promise<string>;
// Every helper that starts a process takes an optional `signal` (the manager's shutdown signal), as runGit does.
export function countUntracked(repo: Repo, limit: number): Promise<number>; // stops at limit + 1
/** Raw bytes of a patch git itself can apply: no textconv, no external diff, fixed prefixes, whole repository. */
export function machinePatch(repo: Repo, from: string, to: string, options: { paths?: string[]; context?: number; binary?: boolean; ignoreWhitespace?: boolean }): Promise<Buffer>;
/** `git apply` of a machinePatch with every byte-changing or matching-relaxing option pinned off. */
export function machineApply(cwd: string, patch: Buffer, options: { reverse?: boolean; cached?: boolean; check?: boolean; env?: Record<string, string> }): Promise<ProcessResult>;
export function submodulePaths(repo: Repo, from: string, to: string, paths?: string[]): Promise<string[]>;
export function entriesOf(repo: Repo, tree: string, paths: string[]): Promise<Map<string, string>>; // path -> "<mode> <oid>"
export function currentEntries(repo: Repo, paths: string[], signal?: AbortSignal): Promise<Map<string, string>>;
```

Rules the code follows:

- `childEnv`: copy `process.env`; on win32 delete every key whose upper-cased name is in the scrub set (on POSIX, exact names): `GIT_ALTERNATE_OBJECT_DIRECTORIES`, `GIT_CEILING_DIRECTORIES`, `GIT_CONFIG`, `GIT_CONFIG_PARAMETERS`, `GIT_CONFIG_COUNT`, `GIT_OBJECT_DIRECTORY`, `GIT_DIR`, `GIT_WORK_TREE`, `GIT_IMPLICIT_WORK_TREE`, `GIT_GRAFT_FILE`, `GIT_INDEX_FILE`, `GIT_NO_REPLACE_OBJECTS`, `GIT_REPLACE_REF_BASE`, `GIT_PREFIX`, `GIT_SHALLOW_FILE`, `GIT_COMMON_DIR`, `GIT_EXTERNAL_DIFF`, `GIT_DIFF_OPTS` (its `-u0` overrides a command-line `-U3`, probed 2026-10-17), `GIT_GLOB_PATHSPECS`, `GIT_NOGLOB_PATHSPECS`, `GIT_ICASE_PATHSPECS` (git refuses them together with the literal mode set below), and every `GIT_CONFIG_KEY_*`/`GIT_CONFIG_VALUE_*`. Then set `GIT_TERMINAL_PROMPT=0`, `GIT_OPTIONAL_LOCKS=0` (read commands never take `index.lock`), `GIT_LITERAL_PATHSPECS=1`, then `extra`; each set first deletes any case-variant of the same name on win32.
- `runProcess`: `spawn(command, args, { cwd, env: childEnv(env), windowsHide: true, detached: process.platform !== "win32" })`, so on POSIX the child leads its own process group. stdout is bounded by `maxStdoutBytes`; stderr keeps only its last `stderrTailBytes` (a ten-minute installer must not grow the server's memory). Killing is observable, not fire-and-forget (`killProcessTree` in `utils/shell.ts:187` returns `void` and discards `taskkill` failures, so it is not used here):
  - POSIX: `process.kill(-pid, "SIGKILL")`, then wait until `process.kill(-pid, 0)` throws `ESRCH`: the group is gone, descendants whose parent died first included (they stay in the group). A descendant that called `setsid` leaves the group and is not seen (`// ponytail: setsid escapes; a cgroup would catch it`).
  - Windows: `taskkill.exe /F /T /PID <pid>` (by its System32 path) with its own 3 s bound, then the child's `close` with another 3 s bound (so a kill started when shutdown begins ends before the stdio server answers unfinished requests with a bare `shuttingDown` at 9 s, `entry.ts:77-79`, and the caller's recovery data reaches the client); on either expiry the child's stdio streams are destroyed and its listeners removed, so nothing keeps the call (or the event loop) waiting. The result is always `ProcessKillUnconfirmed`: a tree listed at one moment can gain a child before it is killed, an already-exited root's descendants are no longer reachable through it, a descendant holding inherited pipes can keep `close` from ever firing, and Node offers no Job Object to make the tree's lifetime observable (`// ponytail: a Job Object, through a native helper, would make Windows kills confirmable`). Callers therefore keep every artifact after a Windows kill.
  - The POSIX wait is bounded at 5 s (same reason): the group confirmed gone → `ProcessKilled`, else `ProcessKillUnconfirmed`. `process.kill(-pid, 0)` failing with `EPERM` means a member is alive (not gone). `ENOENT` on spawn → `AppServerError("toolMissing", "<command> is not on PATH")`.
- **The contract for every caller:** on `ProcessKillUnconfirmed` nothing a process might still be using is removed: no worktree rollback (Task 2), no temporary index directory (left in `os.tmpdir()`), no patch file. The error carries the paths left behind.
- **No user code while a worktree is made.** Codex's crate populates a worktree with hooks, fsmonitor and filters disabled (`codex-rs/worktree/src/git.rs:35-56`), and so does this plan: `noFilters` lists the repository's filter drivers (`git config --null --name-only --get-regexp "^filter\."`, exit 1 = none) and, for each, sets `filter.<name>.process`, `filter.<name>.clean` and `filter.<name>.smudge` to `""` and `filter.<name>.required` to `false` through the environment: `GIT_CONFIG_COUNT=<n>` with `GIT_CONFIG_KEY_<i>`/`GIT_CONFIG_VALUE_<i>`, added after `childEnv`'s scrub (which removes inherited ones), as the crate does (`git.rs:42-51`). A `-c filter.<name>.smudge=` argument would be split at the first `=`, so a driver named `x=y` (which the crate's tests cover, `git_tests.rs:70-83`) would stay enabled. Plus `GIT_LFS_SKIP_SMUDGE=1`. Creation can therefore roll back completely (Task 2). Once setup, an extension or a tool has run in a worktree, it is deleted only after a snapshot (Task 10), so a process that outlives its parent can lose nothing that was committed to the snapshot (`// ponytail: a process still writing into a worktree after its snapshot loses those later writes, as in Codex`).
- `runGit`: `runProcess("git", ["-c", "core.quotepath=false", ...(internal ? ["-c", `core.hooksPath=${process.platform === "win32" ? "NUL" : "/dev/null"}`, "-c", "core.fsmonitor="] : []), ...args], …)`, with the filter overrides above (`GIT_CONFIG_COUNT`/`KEY`/`VALUE`) and `GIT_LFS_SKIP_SMUDGE=1` in the env when `noFilters`.
- `repoOf(cwd)`: `git rev-parse --path-format=absolute --show-toplevel --git-dir --git-common-dir --show-prefix`; exit 128 → `undefined`. Paths through `realpathSync.native`; `prefix` without the trailing `/`.
- `withRepoLock`: a `Map<string, Promise<unknown>>` keyed by `commonDir` (lowercased on win32), chained with errors swallowed, entry deleted when still the latest at settle. `// ponytail: in-process only; another process's git is caught by the preconditions each mutation re-checks.`
- Temporary index (`indexTree`, `snapshotTree`): `mkdtemp` under `os.tmpdir()`; copy `git rev-parse --path-format=absolute --git-path index` when it exists (a missing index is empty); then, in the copy, clear `assume-unchanged` flags: `git ls-files -v -z` entries whose tag is a lower-case letter are fed to `git update-index -z --no-assume-unchanged --stdin`. `skip-worktree` entries whose file exists on disk (`git ls-files -t -z`, tag `S`, then `lstat`) have that flag cleared in the copy too, so an edited materialized file is captured; entries whose file is absent keep it, since in a sparse checkout that absence is not a deletion. `indexTree` then runs `git write-tree`; `snapshotTree` runs `git add -A -- .` (or `git add -u -- .` when `untracked` is false) at `repo.root`, then `git write-tree`. All `internal: true` with `GIT_INDEX_FILE` set to the copy; the temp directory is removed in `finally`.
- `countUntracked`: `git ls-files --others --exclude-standard -z` counting NUL bytes in `onStdout`, stopping past `limit`.
- `machinePatch`: `git -c diff.noprefix=false -c diff.mnemonicPrefix=false -c diff.relative=false -c diff.submodule=short -c diff.suppressBlankEmpty=false -c diff.outputIndicatorNew=+ -c diff.outputIndicatorOld=- -c "diff.outputIndicatorContext= " -c color.ui=false diff --no-color --no-ext-diff --no-textconv --submodule=short --src-prefix=a/ --dst-prefix=b/ -O/dev/null -M --full-index [--binary] [-w] -U<context ?? 3> <from> <to> [-- <paths…>]` (`-w` only for a read with `ignoreWhitespace`; such a patch is never applied), raw `Buffer`, never trimmed or re-encoded. `-O/dev/null` cancels a configured `diff.orderFile` (an empty `-c diff.orderFile=` makes git fail reading the file `''`, probed 2026-10-17; Git for Windows accepts `/dev/null`). Every patch the server reads or applies comes from here, and every name-status or raw listing paired with one passes the same `-O/dev/null`.
- `machineApply`: a zero-byte patch is a no-op that answers `{code: 0}` without starting git (in every mode: `git apply` rejects empty input with "No valid patches in input", exit 128, probed 2026-10-18), so a clean source carries, forks and hands off nothing without failing. Otherwise `git -c apply.whitespace=nowarn -c apply.ignoreWhitespace=no apply --whitespace=nowarn [-R] [--cached] [--check] -` with the patch on stdin, at `cwd`, with an optional `env`. `apply.whitespace=fix` in a user's config would otherwise rewrite reviewed bytes, and `apply.ignoreWhitespace=change` would loosen matching. Every apply the server runs (Tasks 7, 8, 9) goes through it.
- `submodulePaths(repo, from, to, paths?)`: `git -c diff.ignoreSubmodules=none diff --raw -z --no-renames --ignore-submodules=none -O/dev/null <from> <to> [-- <paths>]`, the paths whose old or new mode is `160000` (`diff.ignoreSubmodules=all` in a user's config would otherwise hide them). Revert, stage, unstage, carrying changes into a worktree and handoff refuse a change that touches one, before writing anything (`invalidParams` "submodule changes are not supported here; commit them in the submodule"): `git apply` without `--index` silently skips gitlink changes, so it would report success without doing them.
- `entriesOf(repo, tree, paths)` and `currentEntries(repo, paths)`: `git ls-tree -z <tree> -- <paths>`, keeping only leaf records (blob, symlink, gitlink) whose path is exactly a requested one (mode and object id per path; absent = no entry; `ls-tree -- d` lists `040000 tree … d` itself, probed 2026-10-17, so tree records are dropped), the second over a fresh `snapshotTree(repo, true)`. Task 7's undo compares these entries: the snapshot runs git's own filters (`core.autocrlf`), records the executable bit the way the repository does (`core.fileMode`), stores symlinks as their target, and sees through `assume-unchanged` (cleared in the temporary index). So a later edit, `chmod +x` (with `core.fileMode`), a retargeted link or a flagged file never passes as unchanged (`// ponytail: an EOL-only rewrite that core.autocrlf normalizes away, or a chmod under core.fileMode=false, is not seen; git apply's own check still refuses a reverse patch that no longer matches`).

- [ ] **Step 1: Write the fixture** (`fixtures/git-repo.ts`; spawns git directly so it does not depend on the code under test):

```ts
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readlinkSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

// The fixture is the test oracle, so it scrubs on its own (same list as git.ts's childEnv, written out again here) and
// reads no system or global git config: a user's core.hooksPath or an inherited GIT_OBJECT_DIRECTORY must not reach it.
const SCRUB = new Set([
	"GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_CEILING_DIRECTORIES", "GIT_CONFIG", "GIT_CONFIG_PARAMETERS",
	"GIT_CONFIG_COUNT", "GIT_OBJECT_DIRECTORY", "GIT_DIR", "GIT_WORK_TREE", "GIT_IMPLICIT_WORK_TREE",
	"GIT_GRAFT_FILE", "GIT_INDEX_FILE", "GIT_NO_REPLACE_OBJECTS", "GIT_REPLACE_REF_BASE", "GIT_PREFIX",
	"GIT_SHALLOW_FILE", "GIT_COMMON_DIR", "GIT_EXTERNAL_DIFF", "GIT_DIFF_OPTS", "GIT_GLOB_PATHSPECS",
	"GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS", "GIT_LITERAL_PATHSPECS",
]);
const scrubbed = (key: string) => SCRUB.has(key.toUpperCase()) || /^GIT_CONFIG_(KEY|VALUE)_/i.test(key);

export function shEnv(cwd: string, extra: Record<string, string>, ...args: string[]): string {
	const env: NodeJS.ProcessEnv = {};
	for (const [key, value] of Object.entries(process.env)) if (!scrubbed(key)) env[key] = value;
	Object.assign(
		env,
		{ GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0", GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: devNull },
		extra,
	);
	const result = spawnSync("git", ["-c", "core.quotepath=false", ...args], { cwd, env, encoding: "utf8" });
	if (result.status !== 0) throw new Error(`git ${args.join(" ")}: ${result.stderr}`);
	return result.stdout.replace(/\n$/, "");
}

export const sh = (cwd: string, ...args: string[]) => shEnv(cwd, {}, ...args);
/** Like sh, but null on a non-zero exit (an unborn HEAD). */
export const trySh = (cwd: string, ...args: string[]): string | null => {
	try {
		return sh(cwd, ...args);
	} catch {
		return null;
	}
};
const devNull = process.platform === "win32" ? "NUL" : "/dev/null";

/** A repository at `dir` with one commit of `files` on `main`, a local identity and no signing. */
export function makeRepo(dir: string, files: Record<string, string> = { "a.txt": "one\ntwo\nthree\n" }): void {
	sh(dir, "init", "-q", "-b", "main");
	for (const [key, value] of [
		["user.name", "Test"],
		["user.email", "test@example.com"],
		["commit.gpgsign", "false"],
		["core.autocrlf", "false"],
	])
		sh(dir, "config", key, value);
	for (const [path, text] of Object.entries(files)) write(dir, path, text);
	sh(dir, "add", "-A");
	sh(dir, "commit", "-q", "-m", "initial");
}

export function write(dir: string, path: string, text: string): void {
	mkdirSync(dirname(join(dir, path)), { recursive: true });
	writeFileSync(join(dir, path), text);
}

function fingerprint(path: string): string {
	const info = lstatSyncSafe(path);
	if (!info) return "missing";
	const mode = (info.mode & 0o777).toString(8); // Windows reports 666/444; enough to see a chmod on POSIX
	if (info.isSymbolicLink()) return `link:${mode}:${readlinkSync(path)}`;
	if (info.isDirectory()) return `dir:${mode}`;
	return `file:${mode}:${createHash("sha256").update(readFileSync(path)).digest("hex")}`;
}
const lstatSyncSafe = (path: string) => lstatSync(path, { throwIfNoEntry: false });

/** Everything "unchanged" compares (Global Constraints). Never writes the real index; may add loose objects. */
export function checkoutState(dir: string) {
	const gitDir = sh(dir, "rev-parse", "--path-format=absolute", "--git-dir");
	const status = sh(dir, "status", "--porcelain=v1", "-z", "--untracked-files=all");
	const files: Record<string, string> = {};
	const records = status.split("\0");
	for (let i = 0; i < records.length; i++) {
		const record = records[i];
		if (record.length < 4) continue;
		const path = record.slice(3);
		if (record[0] === "R" || record[0] === "C") i++; // the next record is the source path
		files[path] = fingerprint(join(dir, path));
	}
	// Every tracked file by raw bytes and mode (test repositories are small), so an EOL-only or mode-only change shows
	// even where git's filters or core.fileMode would hide it.
	for (const path of sh(dir, "ls-files", "-z").split("\0")) if (path) files[path] = fingerprint(join(dir, path));
	// Ignored files one by one (not collapsed to their directory), so a changed or removed descendant shows.
	for (const path of sh(dir, "ls-files", "-z", "--others", "--ignored", "--exclude-standard").split("\0"))
		if (path) files[path] = fingerprint(join(dir, path));
	const operation = (name: string) => {
		const path = join(gitDir, name);
		return lstatSyncSafe(path)?.isFile() ? readFileSync(path, "utf8") : existsSync(path) ? "dir" : null;
	};
	// Tracked content through a temporary index with assume-unchanged cleared, so a flagged file that changed shows.
	// Writes objects only, never the real index.
	const temp = join(mkdtempSync(join(tmpdir(), "kc-fixture-")), "index");
	// A fresh repository may have no index (the temporary one then starts empty) and no HEAD (null below).
	const realIndex = sh(dir, "rev-parse", "--path-format=absolute", "--git-path", "index");
	if (existsSync(realIndex)) copyFileSync(realIndex, temp);
	const env = { GIT_INDEX_FILE: temp };
	const flagged = shEnv(dir, env, "ls-files", "-v", "-z").split("\0").filter((e) => /^[a-z] /.test(e));
	for (const entry of flagged) shEnv(dir, env, "update-index", "--no-assume-unchanged", "--", entry.slice(2));
	shEnv(dir, env, "add", "-u", "--", ".");
	const trackedTree = shEnv(dir, env, "write-tree");
	rmSync(dirname(temp), { recursive: true, force: true });
	return {
		head: trySh(dir, "rev-parse", "-q", "--verify", "HEAD"), // null on an unborn branch
		trackedTree,
		index: sh(dir, "ls-files", "-s", "-z"), // mode, blob and stage of every entry; unresolved stages included
		status,
		files,
		operations: Object.fromEntries(
			["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "AUTO_MERGE", "rebase-merge", "rebase-apply"].map((n) => [
				n,
				operation(n),
			]),
		),
	};
}
```

The fixture gets its own tests in `git.test.ts` (below): changing an ignored file inside an ignored directory, removing one of two ignored files there, and (POSIX) `chmod +x` on a tracked file each change `checkoutState`; on a fresh `git init` (no index, no `HEAD`) and on an unborn branch with one staged file, `checkoutState` returns `head: null` without throwing, two calls are equal, and staging a second file changes it.

`harness.ts` gains `sessionDir: null` in `StartServerOptions`: the context then has no explicit session directory and threads use the per-project default layout under the temp `agentDir`, as in production. Tasks 2, 4 and 10 run their listing tests in both layouts.

- [ ] **Step 2: Write the failing tests** (`git.test.ts`):

```ts
import { mkdtempSync, readFileSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { chmodSync, rmSync } from "node:fs";
import {
	childEnv,
	countUntracked,
	git,
	headTree,
	machineApply,
	machinePatch,
	repoOf,
	runProcess,
	snapshotTree,
	withRepoLock,
} from "../../src/app-server/git.ts";
import { checkoutState, makeRepo, sh, write } from "./fixtures/git-repo.ts";

const saved = { ...process.env };
afterEach(() => {
	for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
	Object.assign(process.env, saved);
});

function repoDir() {
	const dir = mkdtempSync(join(tmpdir(), "kc-git-"));
	makeRepo(dir);
	return dir;
}

test("inherited GIT_DIR and GIT_INDEX_FILE, in any letter case on Windows, do not redirect the server's git", async () => {
	const dir = repoDir();
	const other = repoDir();
	const dirName = process.platform === "win32" ? "Git_Dir" : "GIT_DIR";
	const indexName = process.platform === "win32" ? "git_index_file" : "GIT_INDEX_FILE";
	process.env[dirName] = join(other, ".git");
	process.env[indexName] = join(other, ".git", "index");
	expect(Object.keys(childEnv()).some((k) => k.toUpperCase() === "GIT_DIR")).toBe(false);
	for (const name of ["GIT_GLOB_PATHSPECS", "GIT_NOGLOB_PATHSPECS", "GIT_ICASE_PATHSPECS"]) process.env[name] = "1";
	await git(dir, ["add", "--", "a.txt"]); // fails if any of them reached git beside GIT_LITERAL_PATHSPECS
	const repo = await repoOf(dir);
	expect(repo?.root).toBe(realpathSync.native(dir));
	write(dir, "new.txt", "x");
	expect(sh(dir, "ls-tree", "--name-only", await snapshotTree(repo!, true)).split("\n")).toContain("new.txt");
});

test("a snapshot never writes the real index and sees a second edit to an already modified file", async () => {
	const dir = repoDir();
	const repo = (await repoOf(dir))!;
	write(dir, "a.txt", "one\nTWO\nthree\n");
	const index = readFileSync(join(dir, ".git", "index"));
	const first = await snapshotTree(repo, true);
	write(dir, "a.txt", "one\nTWO\nTHREE\n");
	const second = await snapshotTree(repo, true);
	expect(second).not.toBe(first);
	expect(readFileSync(join(dir, ".git", "index")).equals(index)).toBe(true);
});

test("an assume-unchanged file's edit is still in the snapshot; the real flag stays set", async () => {
	const dir = repoDir();
	sh(dir, "update-index", "--assume-unchanged", "a.txt");
	write(dir, "a.txt", "changed\n");
	const tree = await snapshotTree((await repoOf(dir))!, true);
	expect(sh(dir, "cat-file", "blob", `${tree}:a.txt`)).toBe("changed");
	expect(sh(dir, "ls-files", "-v", "a.txt")).toBe("h a.txt");
});

test("tracked-only snapshots leave untracked files out", async () => {
	const dir = repoDir();
	write(dir, "u.txt", "untracked");
	expect(sh(dir, "ls-tree", "--name-only", await snapshotTree((await repoOf(dir))!, false))).not.toContain("u.txt");
});

test("countUntracked stops at limit + 1", async () => {
	const dir = repoDir();
	for (let i = 0; i < 20; i++) write(dir, `u/${i}.txt`, String(i));
	expect(await countUntracked((await repoOf(dir))!, 5)).toBe(6);
});

test("pathspecs are literal", async () => {
	const dir = repoDir();
	write(dir, "a[1].txt", "1");
	write(dir, "a1.txt", "1");
	await git(dir, ["add", "--", "a[1].txt"]);
	expect(sh(dir, "status", "--porcelain")).toBe("A  a[1].txt\n?? a1.txt");
});

test("outside a work tree repoOf is undefined; a subdirectory has a prefix; a linked worktree shares the common dir", async () => {
	expect(await repoOf(mkdtempSync(join(tmpdir(), "kc-nogit-")))).toBeUndefined();
	const dir = repoDir();
	write(dir, "pkg/x.txt", "x");
	sh(dir, "add", "-A");
	sh(dir, "commit", "-q", "-m", "pkg");
	expect((await repoOf(join(dir, "pkg")))?.prefix).toBe("pkg");
	const linked = join(mkdtempSync(join(tmpdir(), "kc-wt-")), "w");
	sh(dir, "worktree", "add", "-q", linked);
	const [main, wt] = [(await repoOf(dir))!, (await repoOf(linked))!];
	expect(wt.commonDir).toBe(main.commonDir);
	expect(wt.gitDir).not.toBe(main.gitDir);
});

test("withRepoLock runs one operation per repository at a time, in order", async () => {
	const repo = (await repoOf(repoDir()))!;
	const order: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	const first = withRepoLock(repo, async () => {
		order.push("first:start");
		await gate;
		order.push("first:end");
	});
	const second = withRepoLock(repo, async () => void order.push("second"));
	await Promise.resolve();
	expect(order).toEqual(["first:start"]);
	release();
	await Promise.all([first, second]);
	expect(order).toEqual(["first:start", "first:end", "second"]);
});

test("aborting a process ends the call within its bound; POSIX confirms the whole group gone", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-proc-"));
	const pidFile = join(dir, "child.pid");
	const [command, args] =
		process.platform === "win32"
			? ["powershell", ["-NoProfile", "-Command", `$p = Start-Process ping -ArgumentList '-n','600','127.0.0.1' -PassThru -WindowStyle Hidden; Set-Content '${pidFile}' $p.Id; Wait-Process -Id $p.Id`]]
			: ["sh", ["-c", `sleep 600 & echo $! > '${pidFile}'; wait`]];
	const controller = new AbortController();
	const running = runProcess(command as string, args as string[], { cwd: dir, signal: controller.signal });
	await expect.poll(() => readFileSync(pidFile, { encoding: "utf8", flag: "a+" }).trim(), { timeout: 15_000 }).not.toBe("");
	const pid = Number(readFileSync(pidFile, "utf8"));
	const began = Date.now();
	controller.abort();
	try {
		if (process.platform === "win32") {
			await expect(running).rejects.toMatchObject({ name: "ProcessKillUnconfirmed" });
		} else {
			await expect(running).rejects.toMatchObject({ name: "ProcessKilled" });
			expect(() => process.kill(pid, 0)).toThrow();
		}
		expect(Date.now() - began).toBeLessThan(25_000);
	} finally {
		try {
			process.kill(pid, "SIGKILL"); // a survivor on Windows is the test's to clean up
		} catch {}
	}
});


test("the fixture ignores an inherited object directory and global hooks", async () => {
	// GIT_OBJECT_DIRECTORY pointing into another repository and a GIT_CONFIG_GLOBAL file setting core.hooksPath to a hook
	// that writes a marker: makeRepo succeeds, the other repository's object count is unchanged, and no marker appears.
});

test("checkoutState sees a rewritten assume-unchanged file", async () => {
	const dir = repoDir();
	sh(dir, "update-index", "--assume-unchanged", "a.txt");
	const before = checkoutState(dir);
	write(dir, "a.txt", "rewritten\n");
	expect(checkoutState(dir)).not.toEqual(before);
});

test("checkoutState sees an ignored descendant change, a removed ignored file and a mode change", async () => {
	const dir = repoDir();
	write(dir, ".gitignore", "build/\n");
	write(dir, "build/a.js", "a");
	write(dir, "build/b.js", "b");
	const before = checkoutState(dir);
	write(dir, "build/a.js", "A");
	expect(checkoutState(dir)).not.toEqual(before);
	write(dir, "build/a.js", "a");
	rmSync(join(dir, "build/b.js"));
	expect(checkoutState(dir)).not.toEqual(before);
	if (process.platform !== "win32") {
		write(dir, "build/b.js", "b");
		chmodSync(join(dir, "a.txt"), 0o755);
		expect(checkoutState(dir)).not.toEqual(before);
	}
});

test("machineApply keeps whitespace exactly under hostile apply config", async () => {
	const dir = repoDir();
	sh(dir, "config", "apply.whitespace", "fix");
	sh(dir, "config", "apply.ignoreWhitespace", "change");
	const repo = (await repoOf(dir))!;
	write(dir, "a.txt", "one\ntwo  \nthree\n"); // trailing spaces the reviewed diff shows
	const patch = await machinePatch(repo, await headTree(repo), await snapshotTree(repo, true), { binary: true });
	sh(dir, "checkout", "--", "a.txt");
	expect((await machineApply(dir, patch, {})).code).toBe(0);
	expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe("one\ntwo  \nthree\n");
});

test("stderr is kept as a bounded tail", async () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-proc-"));
	const result = await runProcess(process.execPath, ["-e", "process.stderr.write('x'.repeat(5 * 1024 * 1024) + 'END')"], {
		cwd: dir,
		stderrTailBytes: 1024,
	});
	expect(result.stderr.length).toBeLessThanOrEqual(1024);
	expect(result.stderr.endsWith("END")).toBe(true);
});

test("a descendant that outlives its parent: POSIX kills and confirms it; Windows reports unconfirmed within the bound", async () => {
	// The child starts a grandchild that inherits its stdout (so close would never fire on its own), writes the
	// grandchild's pid, then exits. Abort: POSIX → ProcessKilled and the pid is gone; Windows → ProcessKillUnconfirmed
	// in under 25 s. The test kills the pid itself in finally.
});

test("hostile diff environment and config do not change machine patches", async () => {
	// GIT_DIFF_OPTS=-u0, diff.orderFile naming a file that lists b before a, diff.outputIndicatorNew=">": machinePatch of
	// a one-line change has three context lines, "+"/"-" indicators and a/ b/ order; a plain readDiff succeeds; a hunk
	// revert through machineApply round-trips.
});

test("git() rejects with GitError carrying stderr", async () => {
	await expect(git(repoDir(), ["rev-parse", "--verify", "nope^{commit}"])).rejects.toMatchObject({ name: "GitError" });
});
```

`expect.poll` re-reads until the pid file has content: it waits on an observable condition, not a fixed time.

Run: `cd packages/cli && bun x vitest --run test/app-server/git.test.ts` — Expected: FAIL (module missing).

- [ ] **Step 3: Implement `git.ts`** as specified.
- [ ] **Step 4:** Run (PASS), then `bun run check-types` from the root.

## Task 1: Phase B protocol schemas

**Files:** Modify `packages/app-server-protocol/src/protocol.ts`, `packages/app-server-protocol/test/protocol.test.ts`; regenerate `packages/cli/docs/app-server.schema.json`.

```ts
export const WorkspaceRequest = Type.Union([
	Obj({ mode: Type.Literal("local") }),
	Obj({
		mode: Type.Literal("worktree"),
		/** Branch or commit to start from; default the project checkout's HEAD (Codex's "What branch should this chat start from?"). */
		baseRef: Type.Optional(Str),
		/** Bring the project checkout's uncommitted changes along, as uncommitted edits. Not with baseRef. */
		carryLocalChanges: Type.Optional(Bool),
		/** A name from the project's .knightcode/environments.json; absent = "Work without environment". */
		environment: Type.Optional(Str),
	}),
]);
export type WorkspaceRequest = Static<typeof WorkspaceRequest>;
export const Workspace = Type.Union([
	Obj({
		mode: Type.Literal("local"),
		/** The worktree a handed-off thread came from; a handoff back returns it there. */
		worktree: Type.Optional(Str),
	}),
	Obj({
		mode: Type.Literal("worktree"),
		/** The worktree's root; the thread's cwd is this or the same subdirectory the project cwd had. */
		path: Str,
		/** The commit the worktree started from (a SHA). */
		baseRef: Str,
		/** The thread that created the worktree. */
		ownerThreadId: Str,
		environment: Type.Optional(Str),
		setupFailed: Type.Optional(Bool),
		/** The worktree was deleted (Task 10); thread/worktree/restore brings it back. */
		deleted: Type.Optional(Bool),
	}),
]);
export type Workspace = Static<typeof Workspace>;
// ThreadSummary gains: workspaceMode: Type.Union([Type.Literal("local"), Type.Literal("worktree")])

const PlatformScript = Obj({
	default: Type.Optional(Str),
	macos: Type.Optional(Str),
	linux: Type.Optional(Str),
	windows: Type.Optional(Str),
});
export const Environment = Obj({
	name: String({ minLength: 1, maxLength: 100 }),
	setup: Type.Optional(PlatformScript),
	cleanup: Type.Optional(PlatformScript),
	/** Shown in the desktop's toolbar and run in its terminal (desktop shell S2); the server only stores them. */
	actions: Type.Optional(
		Type.Array(Obj({ name: String({ minLength: 1, maxLength: 100 }), icon: Type.Optional(Str), command: PlatformScript }), {
			maxItems: 50,
		}),
	),
});
export type Environment = Static<typeof Environment>;

export const DiffScope = Type.Union([
	Type.Literal("lastTurn"),
	Type.Literal("uncommitted"),
	Type.Literal("unstaged"),
	Type.Literal("staged"),
	Type.Literal("committed"),
	Type.Literal("branch"),
]);
export type DiffScope = Static<typeof DiffScope>;
/** Which diff a hunk, a revert or a comment refers to. */
const ScopeSelector = {
	scope: Type.Optional(DiffScope),
	/** `branch`: the branch to compare with (Codex's "HEAD → Select branch"). */
	against: Type.Optional(Str),
	/** `committed`: the commit to show, from git/log. */
	commit: Type.Optional(Str),
};
export const DiffHunk = Obj({
	/** sha256 of path, header and lines: a hunk that changed gets a new id. */
	id: Str,
	header: Str,
	oldStart: Num,
	oldLines: Num,
	newStart: Num,
	newLines: Num,
	/** Each line keeps its prefix: " ", "+", "-", or "\\" for "No newline at end of file". */
	lines: Type.Array(Str),
});
export const DiffFile = Obj({
	path: Str,
	oldPath: Type.Optional(Str),
	status: Type.Union([
		Type.Literal("added"),
		Type.Literal("modified"),
		Type.Literal("deleted"),
		Type.Literal("renamed"),
		Type.Literal("typeChanged"),
	]),
	binary: Bool,
	additions: Num,
	deletions: Num,
	/** Hunks left out: the file's patch is over 512 KiB, or the read's raw or serialized budget ran out (Task 5). */
	tooLarge: Type.Optional(Bool),
	hunks: Type.Array(DiffHunk),
});
export type DiffFile = Static<typeof DiffFile>;
export const DiffComment = Obj({
	...ScopeSelector,
	path: Str,
	/** Codex's L/R: the old or the new side of the diff. */
	side: Type.Union([Type.Literal("old"), Type.Literal("new")]),
	startLine: Type.Integer({ minimum: 1 }),
	endLine: Type.Integer({ minimum: 1 }),
	body: String({ minLength: 1, maxLength: 8000 }),
});
export type DiffComment = Static<typeof DiffComment>;
const ReadContext = Type.Integer({ minimum: 0, maximum: 1_000_000 });
const ActionContext = Type.Integer({ minimum: 1, maximum: 1_000_000 });
const DiffTarget = {
	threadId: Str,
	path: Type.Optional(Str),
	hunkId: Type.Optional(Str),
	context: Type.Optional(ActionContext),
};
```

| Method | Params | Result |
| --- | --- | --- |
| `thread/start` | `workspace?: WorkspaceRequest` (was `Workspace`) | unchanged |
| `thread/fork` | adds `workspace?: {mode: "worktree"}` (absent: the source's workspace) | unchanged |
| `thread/archive` | unchanged | adds `worktree?: {deleted: Bool, snapshot?: Str, reason?: "autoDeleteOff" \| "inUse" \| "notManaged" \| "submodules"}` |
| `thread/handoff` | `{threadId, to: "local" \| "worktree", branch?: String(maxLength 200), environment?: Str}` | `{thread: Thread, branch?: Str, warnings: Warning[]}` |
| `thread/worktree/restore` | `ThreadId` | `{thread: Thread}` |
| `worktree/list` | `{cwd?: Str}` | `{worktrees: {path, projectCwd, head?: Str, branch?: Str, threadIds: Str[], lastUsedAt: Num, deleted: Bool}[]}` |
| `worktree/delete` | `{path: Str}` | `{snapshot?: Str}` |
| `environment/list` | `{cwd: Str}` | `{environments: Environment[], trusted: Bool}` |
| `environment/save` | `{cwd: Str, environments: Environment[] (max 50, unique names)}` | `{}` |
| `thread/diff/read` | `{threadId, ...ScopeSelector, context?: ReadContext, ignoreWhitespace?: Bool}` | `{scope, files: DiffFile[], filesOmitted?: Num, untrackedSkipped?: Num, turnId?: Str, stale?: Bool, against?: Str}` |
| `thread/diff/revert` | `{...DiffTarget, ...ScopeSelector}` | `{paths: Str[]}` |
| `turn/start`, `turn/queue/add` | add `comments?: DiffComment[]` (1..50) | unchanged |
| `git/status` | `ThreadId` | `{branch?: Str, head?: Str, upstream?: Str, ahead: Num, behind: Num, staged: Num, unstaged: Num, untracked: Num, conflicted: Num, operation?: "merge" \| "rebase" \| "cherryPick" \| "revert"}` |
| `git/stage` / `git/unstage` | `DiffTarget` | `{paths: Str[]}` |
| `git/commit` | `{threadId, message?: String(maxLength 20000), includeUnstaged?: Bool}` (default true) | `{commit: Str, message: Str}` |
| `git/push` | `ThreadId` | `{remote: Str, branch: Str, setUpstream: Bool}` |
| `git/pr/create` | `{threadId, title?, body?, draft?: Bool}` | `{url: Str}` |
| `git/branch/create` | `{threadId, name: String(maxLength 200)}` | `{branch: Str}` |
| `git/branch/switch` | `{threadId, name: String(maxLength 200)}` | `{branch: Str}` |
| `git/branches` | `ThreadId` | `{current?: Str, defaultBranch?: Str, branches: Str[]}` |
| `git/log` | `{threadId, limit?: Integer 1..200}` | `{base?: Str, commits: {sha: Str, subject: Str, author: Str, time: Num}[]}` |

`gitConflict`'s `data.reason` (with `paths`, `output` or `recoveryInstructions` as each task says) is one of: `diffChanged`, `patchFailed`, `concurrentChange`, `pushRejected`, `localChanges`, `operationInProgress`, `branchExists`, `recoveryRequired`, `worktreeDeleted`, `worktreeMissing`, `worktreeInUse`, `submodules`; the protocol test checks the list. The user message item gains `comments?: DiffComment[]` (Task 7). Notifications: `"turn/diff/updated": Obj({ threadId: Str, turnId: Str, files: Type.Array(Str) })`, `"thread/workspace/progress": Obj({ threadId: Str, phase: Type.Union([Type.Literal("setup"), Type.Literal("cleanup")]), output: Str })`. The progress `threadId` is the id the thread will have (Task 2 generates it before the session exists).

- [ ] **Step 1:** One valid example per new message in `protocol.test.ts`; rejection cases: `thread/handoff` without `to`, `git/push` with `force: true`, `git/stage` with `context: 0`, a `DiffComment` with `endLine: 0`, `environment/save` with an action that has no `command`. Run `cd packages/app-server-protocol && bun x vitest --run` — FAIL.
- [ ] **Step 2:** Add the schemas (`workspaceMode` on `ThreadSummary` only).
- [ ] **Step 3:** Protocol tests PASS, `bun run generate:schema`, `bun run check-types`. Fix the resulting type errors minimally (`workspaceMode: "local"` in `list`/`read`; `workspace: {mode: "local"}` stays in `toThread`); Task 2 replaces them.

## Task 2: Worktree settings, manifests and worktree threads: create, list, resume

**Files:**
- Create: `packages/cli/src/app-server/workspaces.ts`
- Modify: `packages/cli/src/app-server/threads.ts` (`start`, `list`, `read`, `loadSaved`, `build`, `servicesFor`)
- Modify: `packages/cli/src/app-server/loaded-thread.ts` (`workspace`, `projectCwd`, `toThread`)
- Test: `packages/cli/test/app-server/worktrees.test.ts`

**Interfaces:**

```ts
// workspaces.ts
export interface Manifest {
	version: 2;
	ownerThreadId: string;
	projectCwd: string; // canonical
	mainRoot: string; // canonical root of the project's main checkout, where handed-off threads run
	sourceCwd: string; // canonical checkout directory the worktree was made from (KNIGHTCODE_SOURCE_TREE_PATH)
	cwd: string; // canonical directory the creating thread runs in: path plus the source's prefix (KNIGHTCODE_WORKTREE_PATH)
	commonDir: string; // canonical common git dir of the repository the worktree belongs to
	path: string; // canonical worktree root, <root>/<bucket>/<repoName>
	baseRef: string; // SHA
	environment?: string;
	setupFailed?: true;
	/** Threads handed off (Task 9) and where each runs now: a worktree thread moved to the main checkout ("local"), or a
	 * thread born in the main checkout that runs here ("worktree") or came back ("local", kept for the next handoff). */
	placement: Record<string, "local" | "worktree">;
	/** Branch a handoff checked out in the main checkout; the next handoff to local fast-forwards it (Task 9). */
	handoffBranch?: string;
	lastUsedAt: number;
	/** Set by deletion (Task 10) before the checkout is removed. */
	deleted?: {
		snapshot?: string;
		reason: "archive" | "prune" | "user";
		at: number;
		removalFailed?: true;
		/** The worktree's verified administration directory, saved before removal (Task 10, partly removed checkouts). */
		adminDir?: string;
		afterFailure?: { head: string; index: string; tree: string };
		/** Snapshots of work done in a worktree after a failed removal (Task 10). */
		later?: string[];
	};
}
export interface WorktreeSettings {
	root: string; // worktrees.root, else join(agentDir, "worktrees")
	autoDelete: boolean; // worktrees.autoDelete, default true
	keep: number; // worktrees.keep, default 15
	fetchBeforeCreate: boolean; // worktrees.fetchBeforeCreate, default false
	branchPrefix: string; // worktrees.branchPrefix, default "kc/"
}
/** Test gates only (Global Constraints): each is awaited at the named point. */
export const workspaceHooks = {
	afterWorktreeAdd: async () => {},
	beforeInclude: async () => {},
	afterForkFrom: async () => {},
	beforeHandoffApply: async () => {},
	afterUserCheck: async () => {},
};
export function worktreeSettings(agentDir: string, warnings: Warning[]): WorktreeSettings;
/** The manifest of the managed worktree containing `cwd`, or undefined (not under the root, malformed, or missing). */
export function manifestFor(settings: WorktreeSettings, cwd: string): Manifest | undefined;
/** The manifest that places `threadId` (Task 9), scanned from <root>/*\/worktree.json and memoized per file mtime. */
export function manifestPlacing(settings: WorktreeSettings, threadId: string): Manifest | undefined;
/** Locking: createWorktree, restoreWorktree and deleteWorktree take the repository lock themselves; Task 9's Phase A
 * calls them before its own Phase B takes it, so no call ever waits on a lock its caller holds. */
export function writeManifest(settings: WorktreeSettings, manifest: Manifest): void; // temp file + rename
/** The live cwd and workspace of a thread whose session header names `headerCwd`. */
export function placeThread(settings: WorktreeSettings, threadId: string, headerCwd: string): { cwd: string; workspace: Workspace; manifest?: Manifest };
export interface CreateInput {
	settings: WorktreeSettings;
	projectCwd: string; // identity: environments, manifest, session directory
	sourceCwd: string; // the checkout to start from and, with carryLocalChanges, to copy changes from (Task 4: a fork's source)
	threadId: string;
	ownerThreadId: string;
	baseRef?: string;
	carryLocalChanges?: boolean;
	environment?: string;
	signal: AbortSignal;
	warnings: Warning[];
}
export function createWorktree(input: CreateInput): Promise<{ manifest: Manifest; cwd: string }>;
/** The error to answer when a created worktree is kept after a later failure: the original code, with data.worktree. */
export function keptWorktree(error: unknown, manifest: Manifest): AppServerError;
```

**Settings.** `worktreeSettings` reads the `worktrees` member of the user's global settings (`readSettings` in `config.ts`, global scope only: a project file cannot move the user's worktrees) and checks it with a strict compiled TypeBox schema: `{root?: string (absolute), autoDelete?: boolean, keep?: integer ≥ 1, fetchBeforeCreate?: boolean, branchPrefix?: string}`. An invalid value adds a `settings` warning and uses the defaults. `branchPrefix` plus a sample name must pass `git check-ref-format --branch`, else the default is used with a warning.

**Layout.** `bucket` = 4 lower-case hex digits from `crypto.randomBytes(2)`; `<root>` is created recursively, `<root>/<bucket>` with a non-recursive `mkdir`, and `EEXIST` draws a new bucket (at most 64 tries, then `internal` "no free worktree slot"), so two starts never share one (the crate's `allocate_worktree_root`). The checkout is `<root>/<bucket>/<repoName>` (`repoName = basename(repo.root)`) and the manifest `<root>/<bucket>/worktree.json`.

`manifestFor(settings, cwd)`: canonicalize `cwd` without requiring it to exist (`realpath` of its deepest existing ancestor, then the missing suffix appended: a deleted worktree's cwd is gone, and listings and restore still need its manifest). `relative(realpath(settings.root), that)` must have at least two segments, the first matching `^[0-9a-f]{4}$`; read `<root>/<s0>/worktree.json`, check it with a compiled strict TypeBox schema, and require that `cwd` lies inside `manifest.path`. Memoized per manifest path with its `mtimeMs`. A worktree made under an earlier `worktrees.root` is no longer managed after the setting changes (as in Codex); its threads read as local.

`placeThread(settings, threadId, headerCwd)`: `m = manifestFor(settings, headerCwd)`; when `m.placement[threadId] === "local"`, the thread runs in `join(m.mainRoot, relative(m.path, headerCwd))` (the main checkout, in the same subdirectory the thread had in the worktree) with workspace `{mode: "local", worktree: m.path}`; otherwise in `headerCwd` with workspace `{mode: "worktree", …}` (`deleted` set when `m.deleted`). Without such a manifest, `m = manifestPlacing(settings, threadId)` (any placement value) keeps a thread born in the main checkout associated with its worktree: `"worktree"` runs it in `join(m.path, relative(m.mainRoot, headerCwd))` (workspace `{mode: "worktree", …}`), `"local"` runs it in `headerCwd` with workspace `{mode: "local", worktree: m.path}`, so a later handoff returns to the same worktree; without any placing manifest the thread is local in `headerCwd`.

**`createWorktree`**, under `withRepoLock(sourceRepo)`, `signal` passed to every git call. No user code runs in it: every git call is `internal` (no hooks, no fsmonitor), the populate also passes `noFilters` (Task 0), and the fetch runs before anything exists. So it owns a complete rollback: a `created` record tracks what exists (bucket, manifest, registration), and any failure or abort (including `ProcessKilled`) removes it with a fresh, unaborted signal before rethrowing. On `ProcessKillUnconfirmed` nothing is removed (Task 0's contract) and the error names the bucket.

1. `sourceRepo = requireRepo(sourceCwd)` (`notGitRepo`); `prefix = sourceRepo.prefix` (where the thread runs, relative to the repository root, as the crate derives it from `source_cwd`, `lib.rs:65-71`; `projectCwd` is only the thread's identity, and a start inside an existing worktree's `pkg/` must run in the new worktree's `pkg/`). The manifest records `mainRoot = requireRepo(projectCwd).root`. `carryLocalChanges` with `baseRef` → `invalidParams` ("local changes belong to the current checkout").
2. With `fetchBeforeCreate`, before the base is resolved: `full = git rev-parse --symbolic-full-name <baseRef ?? HEAD>`. A remote-tracking ref (`refs/remotes/<remote>/<branch>`, `<remote>` being the longest configured remote name, `git remote`, that prefixes it) → `git fetch --quiet --no-tags <remote>`; a local branch (`refs/heads/…`, or `HEAD` on one) with an upstream (`git rev-parse --abbrev-ref --symbolic-full-name <ref>@{upstream}`) → fetch that upstream's remote; anything else (a tag, a SHA, no upstream) → no fetch. A 2-minute timeout; a failure adds a `server` warning and creation continues from what is there.
3. `baseSha = git rev-parse --verify --end-of-options <baseRef ?? "HEAD">^{commit}` in `sourceRepo.root`. Failure → `invalidParams` "no commit <baseRef>"; an unborn `HEAD` → `invalidParams` "commit something first: a worktree starts from a commit".
4. A non-empty `prefix` must name a directory in the base: `git cat-file -t <baseSha>:<prefix>` prints `tree`, else `invalidParams` "the base commit has no <prefix>" (probed: a missing path exits 128).
5. With `carryLocalChanges`: `patch = machinePatch(sourceRepo, HEAD^{tree}, snapshotTree(sourceRepo, true), {binary: true})` of the source checkout (untracked included, ignored not; no 500-file cap, a one-time cost the user asked for); a submodule change in it → `invalidParams` (`submodulePaths`). Taken before anything is created; the source is never written.
6. Allocate the bucket; write the manifest (`baseRef = baseSha`, `sourceCwd`, `cwd = join(path, …prefix)`, `placement: {}`, `lastUsedAt = Date.now()`), so a crash after this point leaves a describable worktree whose cleanup script still gets the same two paths its setup got.
7. `git worktree add --detach --no-checkout <path> <baseSha>` at `sourceRepo.root`: registration and `.git` file only.
8. **Populate**, following the crate (`lib.rs:105-138`): first `git config --file <git rev-parse --path-format=absolute --git-path config.worktree> core.worktree <path>` run in `<path>` (only the new worktree's own file: the shared config and `extensions.worktreeConfig` are untouched), so a shared `core.worktree` naming the main checkout can never point this worktree's commands there; then `git --work-tree=. reset -q --hard --no-recurse-submodules <baseSha>` in `<path>`, `noFilters` (Task 0): clean blobs are written as stored, so an LFS file is its pointer, as in Codex. Every later working-tree command the server runs in a worktree (Task 9's checkout, Task 10's restore) passes `--work-tree=.` the same way.
9. With `carryLocalChanges`: `machineApply(path, patch, {check: true})`, then without `check` (working tree only: the carried changes stay uncommitted, new files untracked).
10. `cwd = join(path, ...prefix.split("/").filter(Boolean))`.

Then Task 3's `.worktreeinclude` copy and setup run, then the load. A failure after `createWorktree` returned keeps the worktree (setup or extension code may have run in it), answers with `keptWorktree(error, manifest)` (`data: {worktree: <path>}`), and leaves it to pruning (Task 10), which treats a worktree whose owner has no session file as unused.

**`ThreadManager.start`** with `workspace.mode === "worktree"`:

```ts
const threadId = uuidv7(); // @knightcode/ai
const warnings: Warning[] = [];
const settings = worktreeSettings(this.ctx.agentDir, warnings);
const created = await createWorktree({
	settings, projectCwd: cwd, sourceCwd: cwd, threadId, ownerThreadId: threadId,
	baseRef, carryLocalChanges, environment, signal: this.shutdown.signal, warnings,
});
try {
	await prepareWorktree(/* Task 3: .worktreeinclude, setup */);
	const sessionManager = SessionManager.create(created.cwd, liveDirFor(this.ctx, cwd), { id: threadId });
	// … the existing load / setModel / subscribe path; warnings are appended to the result
} catch (error) {
	throw keptWorktree(error, created.manifest);
}
void this.track(() => pruneWorktrees(/* Task 10 */));
```

`this.shutdown` is a new manager-wide `AbortController`, aborted first thing in `closeAll()`. The model is selected after the load, as today (`threads.ts:182-194`): a model the new thread's own extension registers exists only then.

**Project identity at every start.** `start()` computes `projectCwd = manifestFor(settings, cwd)?.projectCwd ?? cwd` before anything else and uses it for the session directory in both modes (`liveDirFor(this.ctx, projectCwd)`; today `threads.ts:182` uses the cwd). A `{mode: "local"}` start inside a managed worktree is a thread in that worktree (Codex's "New chat in this worktree"), listed under its project; a `{mode: "worktree"}` start there starts from that worktree's `HEAD` (`sourceCwd = cwd`) under the same project.

**Workspace from cwd and placement.** `loadSaved` opens the session with `SessionManager.open(path, dir, placed.cwd)` where `placed = placeThread(settings, id, <header cwd>)`; a `placed.workspace.deleted` thread answers `gitConflict {reason: "worktreeDeleted", recoveryInstructions: ["The worktree of this chat was deleted. Restore it to continue."]}` before opening (Task 10), while `thread/read` keeps working. `build()` passes `projectCwd = placed.manifest?.projectCwd ?? cwd` to `new LoadedThread(...)` and to `servicesFor(cwd, projectCwd, holder)`. `servicesFor` checks trust as `!hasTrustRequiringProjectResources(cwd) || ProjectTrustStore.get(projectCwd) === true` and keeps `SettingsManager.create(cwd, …)` (the worktree's own files). The load warning in `build()` (`threads.ts:720-724`) uses the same `projectCwd`. `LoadedThread.workspace` is a getter over `placeThread`, so a manifest update shows on the next `toThread()`. `bind()`'s `newSession` and extension `fork` pass the session cwd and `thread.projectCwd`, so replacements stay in the workspace; Task 4 tests it. Each load and each `turn/completed` writes `lastUsedAt` (at most once a minute per manifest).

**Listing.** `list()` and `read()` compute `placeThread(settings, info.id, info.cwd)`: `projectCwd = manifest?.projectCwd ?? info.cwd`, `workspaceMode` from the workspace. With an explicit session directory, the `cwd` filter compares `projectCwd`.

- [ ] **Step 1: Failing tests** (`worktrees.test.ts`):

```ts
import { fauxAssistantMessage, fauxText } from "@knightcode/ai";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";
import { checkoutState, makeRepo, sh, write } from "./fixtures/git-repo.ts";

afterEach(cleanupServers);

export async function repoServer(files?: Record<string, string>, options?: Parameters<typeof startServer>[0]) {
	const server = await startServer(options);
	makeRepo(server.cwd, files);
	const a = await server.connect("desktop");
	return { ...server, root: realpathSync.native(server.cwd), a };
}
type RepoServer = Awaited<ReturnType<typeof repoServer>>;

export async function say(s: RepoServer, threadId: string, text = "ok") {
	s.faux.setResponses([fauxAssistantMessage([fauxText(text)])]);
	await s.a.client.request("turn/start", { threadId, text: "hi" });
	await s.a.waitFor("turn/completed", (p) => (p.turn as { threadId: string }).threadId === threadId);
}

export async function worktreeThread(s: RepoServer, request: object = {}) {
	const { thread, warnings } = await s.a.client.request("thread/start", {
		cwd: s.cwd,
		workspace: { mode: "worktree", ...request },
	});
	if (thread.workspace.mode !== "worktree") throw new Error("expected a worktree thread");
	return { thread, workspace: thread.workspace, warnings };
}

test("a worktree thread runs on a detached HEAD at the base SHA, listed under its project, and resumes as one", async () => {
	const s = await repoServer();
	const head = sh(s.cwd, "rev-parse", "HEAD");
	const branches = sh(s.cwd, "branch", "--list");
	const { thread, workspace } = await worktreeThread(s);
	expect(workspace).toMatchObject({ baseRef: head, ownerThreadId: thread.id });
	expect(thread.cwd).toBe(workspace.path);
	expect(thread.projectCwd).toBe(s.root);
	expect(() => sh(thread.cwd, "symbolic-ref", "-q", "HEAD")).toThrow(); // detached
	expect(sh(thread.cwd, "rev-parse", "HEAD")).toBe(head);
	expect(sh(s.cwd, "branch", "--list")).toBe(branches); // no branch created
	expect(workspace.path).toMatch(/[\\/][0-9a-f]{4}[\\/][^\\/]+$/);
	await say(s, thread.id);
	const listed = await s.a.client.request("thread/list", { cwd: s.cwd });
	expect(listed.threads.find((t) => t.id === thread.id)).toMatchObject({ projectCwd: s.root, workspaceMode: "worktree" });
	await s.threads.unload(thread.id);
	expect((await s.a.client.request("thread/resume", { threadId: thread.id })).thread.workspace).toEqual(workspace);
});

test("the manifest exists before the first message, so an unsaved worktree thread is still described", async () => {
	const s = await repoServer();
	const { workspace } = await worktreeThread(s);
	const manifest = JSON.parse(readFileSync(join(dirname(workspace.path), "worktree.json"), "utf8"));
	expect(manifest).toMatchObject({ version: 2, ownerThreadId: workspace.ownerThreadId, placement: {} });
});

test("two worktree threads started together get different buckets", async () => {
	const s = await repoServer();
	const [x, y] = await Promise.all([worktreeThread(s), worktreeThread(s)]);
	expect(dirname(x.workspace.path)).not.toBe(dirname(y.workspace.path));
});

test("a thread started in a subdirectory runs in the same subdirectory of its worktree", async () => {
	const s = await repoServer({ "pkg/x.txt": "x" });
	const { thread } = await s.a.client.request("thread/start", { cwd: join(s.cwd, "pkg"), workspace: { mode: "worktree" } });
	if (thread.workspace.mode !== "worktree") throw new Error("unreachable");
	expect(thread.cwd).toBe(join(thread.workspace.path, "pkg"));
	expect(existsSync(join(thread.cwd, "x.txt"))).toBe(true);
});

test("outside git, worktree mode answers notGitRepo and leaves nothing behind", async () => {
	const s = await startServer();
	const a = await s.connect("desktop");
	await expect(a.client.request("thread/start", { cwd: s.cwd, workspace: { mode: "worktree" } })).rejects.toMatchObject({ code: "notGitRepo" });
	expect(existsSync(join(s.agentDir, "worktrees"))).toBe(false);
});

test("a bad baseRef answers invalidParams and leaves no registration or bucket", async () => {
	const s = await repoServer();
	await expect(worktreeThread(s, { baseRef: "nope" })).rejects.toMatchObject({ code: "invalidParams" });
	expect(sh(s.cwd, "worktree", "list", "--porcelain")).not.toContain("worktrees");
});

test("a shared core.worktree naming the main checkout does not let creation write there", async () => {
	/* the crate's creation_preserves_dirty_source_with_shared_git_config: core.worktree=<main checkout>,
	   extensions.worktreeConfig=true and a dirty tracked file in the main checkout; a worktree thread starts; the main
	   checkout's file and .git/config bytes are unchanged, the worktree has the committed file and a clean status */
});

test("creation runs no filter or hook, and a failure inside it rolls back completely", async () => {
	/* also with a second driver named x=y (`*.md filter=x=y`), whose smudge would write a marker too; the repository configures filter.x.smudge to append to a marker file outside the repo, `*.txt filter=x`, and a
	   post-checkout hook writing another marker: a worktree thread starts, neither marker exists, a.txt holds the
	   committed blob. Then workspaceHooks.afterWorktreeAdd throws: thread/start rejects, no registration, no bucket. */
});

test("carryLocalChanges brings the checkout's edits and untracked files as uncommitted changes, not ignored files", async () => {
	const s = await repoServer({ ".gitignore": "secret.txt\n" });
	write(s.cwd, "a.txt", "one\nedited\nthree\n");
	write(s.cwd, "new.txt", "untracked");
	write(s.cwd, "secret.txt", "ignored");
	const before = checkoutState(s.cwd);
	const { thread, workspace } = await worktreeThread(s, { carryLocalChanges: true });
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("one\nedited\nthree\n");
	expect(sh(thread.cwd, "status", "--porcelain")).toBe(" M a.txt\n?? new.txt");
	expect(existsSync(join(thread.cwd, "secret.txt"))).toBe(false);
	expect(workspace.baseRef).toBe(sh(s.cwd, "rev-parse", "HEAD"));
	expect(checkoutState(s.cwd)).toEqual(before);
	await expect(worktreeThread(s, { carryLocalChanges: true, baseRef: "HEAD" })).rejects.toMatchObject({ code: "invalidParams" });
});

test("an unknown model answers invalidParams and keeps the created worktree", async () => {
	const s = await repoServer();
	const error = await s.a.client
		.request("thread/start", { cwd: s.cwd, workspace: { mode: "worktree" }, model: { provider: "nope", id: "nope" } })
		.catch((e: unknown) => e);
	expect(error).toMatchObject({ code: "invalidParams", data: { worktree: expect.any(String) } });
});

test("a model registered only by the new worktree's trusted extension is selected on a cold start", async () => {
	/* the trusted project commits .knightcode/extensions/model.ts registering provider "ext", model "m"; no thread is
	   loaded; thread/start {workspace: {mode: "worktree"}, model: {provider: "ext", id: "m"}} succeeds with that model */
});

test("the worktree inherits the project's trust decision", async () => {
	const s = await repoServer({ ".knightcode/settings.json": "{}" });
	await s.a.client.request("project/trust/set", { cwd: s.cwd, trusted: true });
	const { warnings } = await worktreeThread(s);
	expect(warnings.filter((w) => w.source === "trust")).toEqual([]);
});

test("worktrees.root moves new worktrees; fetchBeforeCreate brings an upstream commit in", async () => {
	/* global settings {worktrees: {root: <temp>, fetchBeforeCreate: true}}; a bare origin gets a commit pushed from a
	   second clone; a worktree thread with baseRef "origin/main" (a remote-tracking ref) has that commit; one with no
	   baseRef on a local main tracking origin/main starts at the unchanged local HEAD, while origin/main now has the
	   commit (the fetch ran); its path is under <temp>.
	   A fetch failure (origin removed) still creates the worktree with a server warning. */
});
```

Also: with `startServer({ sessionDir: null })`, a local start and a worktree start whose `cwd` is inside an existing managed worktree both list under the project after unload; `readdirSync(<root>)` shows only 4-hex buckets.

- [ ] **Step 2:** Run — FAIL. **Step 3:** Implement. **Step 4:** Run the file and all of `test/app-server/` (local threads list exactly as before), `bun run check-types`.

## Task 3: Environments, `.worktreeinclude`, setup and progress

**Files:** Modify `workspaces.ts`, `threads.ts`; test `packages/cli/test/app-server/worktree-setup.test.ts` (imports `repoServer`, `worktreeThread` from `worktrees.test.ts`'s helpers, moved to `fixtures/worktree-server.ts` in this task).

- **Environment file.** `<projectCwd>/.knightcode/environments.json`: `{version: 1, environments: Environment[]}` (Task 1's schema, names unique). `environment/list {cwd}` reads it (missing file → `[]`; invalid → `invalidParams` naming the problem) and returns `trusted = ProjectTrustStore.get(projectCwd) === true`. `environment/save {cwd, environments}` validates and writes it with a temp file and rename (`mkdir .knightcode` first); it writes no code that runs, so it needs no trust. A start or handoff naming an environment that is not in the file → `invalidParams`, before anything is created. An untrusted project's environment is never run: the start continues without setup and carries a `trust` warning, and the manifest still records the name, so a later cleanup is skipped the same way.
- **Script choice.** `scriptFor(p: PlatformScript)`: the `macos`, `linux` or `windows` variant for `process.platform` (`darwin`, `linux`, `win32`) when present and not blank, else `default` when not blank, else none.
- **`.worktreeinclude`** (copied before setup, whether or not an environment was picked): the file at the source repository's root, gitignore syntax. Candidates are `git ls-files -z --others --ignored --exclude-from=<that file>` run at the source root (`--ignored` lists untracked files *matching* the patterns; without it git lists every untracked file that does not, probed 2026-10-17); each candidate's source is `join(sourceRoot, path)` and its destination `join(worktreeRoot, path)`. A candidate is copied only when it is ignored by the source's own rules (`git check-ignore -q -- <path>` at the source root) *and* by the worktree's (`git check-ignore -q --no-index -- <path>` in the worktree): otherwise the copy would be an ordinary untracked file there, and a commit with `includeUnstaged` or a handoff would publish a secret meant only for local use. Such a file is skipped with a `server` warning naming it. For each copied path: the source must be a regular file (`lstat`; symlinks skipped). The destination's directories are walked one component at a time from the worktree root, never created before they are checked: an existing component must be a real directory (`lstat`, not a symlink; Node reports Windows junctions as symlinks), a missing one is made with a non-recursive `mkdir`; a component that is a link skips the file with a `server` warning. Copy with `COPYFILE_EXCL`. At most 10,000 files and 512 MiB; past either, stop with a `server` warning.
- **Setup** (environment picked, project trusted, `scriptFor(setup)` present): with `{shell, args, commandTransport} = getShellConfig()` exactly as `resolve-config-value.ts:153-160` uses it: `runProcess(shell, commandTransport === "stdin" ? args : [...args, script], {cwd: projectCwd, input: commandTransport === "stdin" ? script : undefined, env: {KNIGHTCODE_SOURCE_TREE_PATH: sourceCwd, KNIGHTCODE_WORKTREE_PATH: <thread cwd>}, timeoutMs: 600_000, signal: this.shutdown.signal, collectStdout: false, onStdout, onStderr})`: at the project root, as in Codex, so a script starts with `cd "$KNIGHTCODE_WORKTREE_PATH"`. Output exists only in the progress stream and a 4 KiB ring, so a verbose installer can neither hit an output cap nor grow memory. No usable shell (`getShellConfig` throws, or `toolMissing`) is a setup failure like a non-zero exit. Output streams as `thread/workspace/progress {threadId, phase: "setup", output}` to the connection that called `thread/start`, coalesced to one notification per 100 ms and at most 64 KiB each; the pending buffer between notifications holds at most 64 KiB (older output is dropped with a `[… N bytes dropped]` marker). Non-zero exit or timeout: keep the worktree, write `setupFailed: true` to the manifest, return the thread with a `server` warning carrying the last 4 KiB of output. A timeout that ends in `ProcessKillUnconfirmed` (always on Windows) is still `setupFailed`, with the warning saying a setup process may still be running. Shutdown during setup kills it (bounded, Task 0) and answers `shuttingDown` with `data.worktree`.
- **Cleanup** (Task 10 calls it before deleting): the same shape with `scriptFor(cleanup)`, its two variables taken from the manifest's `sourceCwd` and `cwd` (so background pruning after a restart passes exactly what setup got), `phase: "cleanup"` progress to the connection that asked (none for background pruning: stderr), a 5-minute timeout; a failure adds a `server` warning and the deletion continues (the snapshot already holds the work).

- [ ] **Step 1: Failing tests:**

```ts
test("environment/save then environment/list round-trips; an invalid file answers invalidParams", async () => {
	/* save [{name: "node", setup: {default: "npm ci", windows: "npm.cmd ci"}, actions: [{name: "Run", command: {default:
	   "npm start"}}]}]; list returns it and trusted: false; the file is <cwd>/.knightcode/environments.json; a file with a
	   duplicate name → environment/list rejects with invalidParams */
});

test("setup runs at the project root with the source and worktree paths, and its platform variant wins", async () => {
	/* environment "e": setup.default writes "default" to "$KNIGHTCODE_WORKTREE_PATH/which.txt", and the variant for the
	   current platform writes "platform" plus "$PWD" and "$KNIGHTCODE_SOURCE_TREE_PATH"; trusted project; worktree
	   thread with environment "e": which.txt says "platform", the recorded cwd and source path are the project root */
});

test("no environment, no setup; an unknown environment is invalidParams before anything is created", async () => {
	/* the file has an environment with a setup that writes a marker; a worktree start without `environment` writes
	   none; environment: "nope" → invalidParams and no bucket */
});

test(".worktreeinclude copies a matching ignored .env and nothing else", async () => {
	const s = await repoServer({ ".gitignore": ".env\nother.log\n", ".worktreeinclude": ".env\n" });
	write(s.cwd, ".env", "KEY=1");
	write(s.cwd, "other.log", "log");
	const { thread } = await worktreeThread(s);
	expect(readFileSync(join(thread.cwd, ".env"), "utf8")).toBe("KEY=1");
	expect(existsSync(join(thread.cwd, "other.log"))).toBe(false);
});

test(".worktreeinclude skips a file the base commit would not ignore", async () => {
	/* the project ignores .env now; baseRef is an older commit without that rule; .worktreeinclude lists .env:
	   no .env in the worktree, and a warning names it */
});

test(".worktreeinclude never creates or writes anything through a link in the destination", async () => {
	// The source has a real directory conf/new/ holding ignored local.env; .worktreeinclude lists conf/new/local.env.
	// POSIX: baseRef is a commit where conf is a symlink to an outside directory. Windows (git does not check out
	// junctions): workspaceHooks.beforeInclude, a gate after the populate, replaces the worktree's conf with a junction
	// (fs.symlinkSync(outside, conf, "junction")). Afterwards the outside directory's listing is unchanged and a server
	// warning names the skipped file.
});

test("a failing setup keeps the thread, sets setupFailed, warns with its output and streamed progress", async () => {
	/* environment setup "echo installing; exit 3" (bash, Git Bash on Windows): workspace.setupFailed, a server warning
	   containing "installing", progress notifications with phase "setup" and the new thread's id */
});

test("an untrusted project's environment does not run", async () => {
	/* environment setup writes a marker; project not trusted; the worktree starts, no marker, a trust warning */
});

test("shutdown during setup kills the setup and keeps the worktree with recovery data", async () => {
	// setup: start a long-lived descendant, write its pid to "$KNIGHTCODE_WORKTREE_PATH/../setup.pid", print "started",
	// wait. Wait for progress containing "started"; closeAll() resolves within 25 s; thread/start rejects with
	// shuttingDown and data.worktree; the worktree and manifest remain; POSIX: process.kill(pid, 0) throws. The test kills
	// the pid and removes the worktree itself in finally.
});

test("EOF on a real stdio server during setup answers shuttingDown with data.worktree before the hard exit", async () => {
	// spawn `bun src/cli.ts app-server` as stdio.test.ts's spawnServer does, with a setup that waits forever (and, on
	// Windows, a descendant holding its pipes so close never fires); after "started", end stdin. The thread/start error
	// arrives before 9 s with data.worktree; the process exits 0.
});
```

The bodies written as comments are written in full during implementation, following the comment; the scripts are per shell (`getShellConfig()` picks bash where available, also on Windows via Git Bash; the test skips with a reason when no bash is found). Two more cases: a setup printing 100 MiB to stdout ends normally with a bounded warning; a setup through a shell whose `commandTransport` is `"stdin"` (a test-only `getShellConfig` result injected through `ThreadManagerOptions.shellConfig`) runs the script.

- [ ] **Step 2–4:** Run (FAIL), implement, run the file and `worktrees.test.ts`, `bun run check-types`.

## Task 4: Fork into the same workspace or a new worktree

**Files:** Modify `threads.ts` (`fork`); test `packages/cli/test/app-server/worktree-fork.test.ts`.

`thread/fork {threadId, atItemId?, workspace?}`. The source's live cwd and project come from `placeThread` for loaded and unloaded sources alike (`threads.ts:425-433` computes the header cwd today); `sourceProject = manifest?.projectCwd ?? sourceCwd`. In every mode the fork's session file goes to `liveDirFor(ctx, sourceProject)`, not `liveDirFor(ctx, cwd)` as `fork()` does today (`threads.ts:433-443`): with the default per-project layout, a fork whose cwd is a worktree would otherwise land in a directory named after the worktree and vanish from its project's listing. (The harness's explicit session directory hid this; Task 0's `sessionDir: null` option exposes it.)

- absent (Codex's "Fork in this worktree", or "Fork chat" for a local thread): the fork's cwd is the source's live cwd, so it shares the source's worktree (the manifest's owner stays the source), or runs where a handed-off source runs. A fork of a handed-off thread is a plain local thread there.
- `{mode: "worktree"}` (Codex's "Fork in a new worktree"): `createWorktree({projectCwd: sourceProject, sourceCwd, threadId: id, ownerThreadId: id, carryLocalChanges: true, environment: <the source worktree's environment, if any>, …})` with a fresh `id = uuidv7()`: the base is the source checkout's `HEAD` (a worktree source's own commits come along) and its uncommitted changes are applied as uncommitted edits. A source whose worktree was deleted forks from its snapshot instead: the snapshot's parent is the base and the snapshot's changes are carried (Task 10's restore path, into the new bucket); without a snapshot it starts from the manifest's `baseRef`. The session is `SessionManager.forkFrom(source, created.cwd, liveDirFor(ctx, sourceProject), {id, leafId})`, which writes the fork's transcript at once (`session-manager.ts:1995-2018`). The fork is not returned until it loaded, so on any failure after `forkFrom` the fork's transcript is removed (the manager is closed and the file is unlinked only if its header id is the new `id`, taking its lock exclusively, as `thread/delete` does), and the worktree is kept with `data.worktree`. A plain fork that fails after `forkFrom` unlinks its transcript the same way (today it is left behind).

- [ ] **Step 1: Failing tests:**

```ts
test("a plain fork of a worktree thread shares the worktree and does not own it", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	await say(s, thread.id);
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id });
	expect(fork.cwd).toBe(thread.cwd);
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: thread.id });
});

test("a fork into a new worktree carries the source worktree's commits and uncommitted edits", async () => {
	const s = await repoServer();
	const { thread } = await worktreeThread(s);
	await say(s, thread.id);
	write(thread.cwd, "committed.txt", "c");
	sh(thread.cwd, "add", "-A");
	sh(thread.cwd, "commit", "-q", "-m", "thread commit");
	write(thread.cwd, "a.txt", "from the source thread\n");
	const { thread: fork } = await s.a.client.request("thread/fork", { threadId: thread.id, workspace: { mode: "worktree" } });
	expect(fork.workspace).toMatchObject({ mode: "worktree", ownerThreadId: fork.id });
	expect(readFileSync(join(fork.cwd, "committed.txt"), "utf8")).toBe("c");
	expect(sh(fork.cwd, "status", "--porcelain")).toBe(" M a.txt");
	expect(readFileSync(join(thread.cwd, "a.txt"), "utf8")).toBe("from the source thread\n"); // the source keeps them
	expect(fork.projectCwd).toBe(s.root);
});

test("a clean source forks into a new worktree; a start inside a worktree's subdirectory keeps it", async () => {
	/* a worktree thread with no uncommitted changes forks {mode: "worktree"} without error (empty carried patch); a start
	   with cwd <worktree>/pkg and {mode: "worktree"} runs in <new worktree>/pkg */
});

test("a local thread forks into a new worktree with its checkout's uncommitted edits", async () => {
	/* local thread in the main checkout; edit a.txt; fork {mode: "worktree"}: the fork's worktree has the edit
	   uncommitted, the main checkout is unchanged (checkoutState) */
});

test("a fork into a new worktree that fails to load leaves no transcript and keeps the worktree with recovery data", async () => {
	/* workspaceHooks.afterForkFrom throws: thread/fork rejects with data.worktree; the fork's transcript is unlinked and
	   unlocked; the worktree and manifest remain; no new entry in thread/list {cwd}, in both session layouts */
});

test("a source whose worktree was deleted forks into a new worktree from its snapshot", async () => {
	/* worktree thread with a commit and an uncommitted edit, archive (worktree deleted with a snapshot), restart, fork
	   {mode: "worktree"}: the fork has the commit and the edit, uncommitted; in both session layouts */
});

test("with the default session layout, every kind of fork of a worktree thread lists under the project", async () => {
	/* startServer({ sessionDir: null }); plain and worktree forks; unload all; thread/list {cwd: project} has both and the
	   source */
});

test("an extension's newSession and empty fork from a worktree thread stay in the worktree", async () => {
	/* an extraExtensions fixture registers a command calling ctx.newSession() and one calling ctx.fork(firstUserEntryId);
	   after each, thread/replaced's thread has the source's workspace (same path, ownerThreadId = source) and projectCwd */
});
```

- [ ] **Step 2–4:** Run (FAIL), implement, run with `thread-methods.test.ts` and `replacement.test.ts`, `bun run check-types`.

## Task 5: `thread/diff/read` with scopes

**Files:** Create `packages/cli/src/app-server/diff.ts`; modify `threads.ts`; test `packages/cli/test/app-server/diff.test.ts`.

```ts
export interface ScopeTrees { from: string; to: string; untrackedSkipped?: number; turnId?: string; stale?: boolean; against?: string }
export function scopeTrees(thread: LoadedThread, repo: Repo, selector: { scope: DiffScope; against?: string; commit?: string }): Promise<ScopeTrees>;
export function readDiff(repo: Repo, trees: ScopeTrees, options: { context: number; ignoreWhitespace?: boolean }): Promise<DiffFile[]>;
export function splitPatch(names: NameStatus[], patch: Buffer): Map<NameStatus, Buffer[]>; // exported for unit tests
export function hunkId(path: string, header: string, lines: readonly string[]): string;
```

| Scope | from | to | Allowed |
| --- | --- | --- | --- |
| `lastTurn` | newest `knightcode.turnDiff` record's `before` | its `after` | none → `files: []`, no `turnId`; a pruned object (`git cat-file -e`) → `files: []`, `stale: true` |
| `uncommitted` (default) | `headTree` | snapshot | |
| `unstaged` | `indexTree` | snapshot | |
| `staged` | `headTree` | `indexTree` | |
| `committed` | `<commit>^{tree}`'s first parent's tree (`emptyTree` for a root commit) | `<commit>^{tree}` | `commit` required (`invalidParams` without), resolved with `rev-parse --verify --end-of-options <commit>^{commit}` |
| `branch` | `git merge-base <against> HEAD`'s tree | snapshot | `against` defaults to the worktree's `baseRef`, else the current branch's upstream, else the repository's default branch: the remote `HEAD` (origin first), then `origin/main`, `origin/master`, `main`, `master` (the crate's `default_worktree_base`, `git.rs:99-140`); none, or no merge base → `invalidParams`. The result echoes `against` |

The snapshot includes untracked files unless `countUntracked(repo, 500)` exceeds 500; then tracked only, and `untrackedSkipped` is a second count capped at 1,000,000.

`readDiff`:

1. `git diff --name-status -z -M --no-ext-diff --no-textconv <from> <to>` (whole repository; the desktop filters by the thread's subdirectory).
2. `machinePatch(repo, from, to, {context, ignoreWhitespace})` with `maxStdoutBytes: 16 MiB` (Codex's "Hide white space"; a hunk id from such a read never matches the plain diff a revert or stage recomputes, so the client offers no hunk actions while it is on); over the cap, every file from step 1 has `tooLarge: true` and no hunks.
3. `splitPatch`: sections start at lines beginning `diff --git `. For each name-status entry in order, the expected header is `diff --git <q(a/old)> <q(b/new)>` where `q` applies git's C-style quoting (wrap in `"…"` and escape `"`, `\`, and control bytes as `\t`, `\n`, `\ooo`) only when the path contains one of them, as git does with `core.quotepath=false`. A `T` (type change) entry consumes one or two consecutive sections with its header (git may emit a deletion and a creation); every other entry consumes exactly one, except in an `ignoreWhitespace` read, where an ordinary `M` entry whose only changes are whitespace has no section (git emits none under `-w`) and is left out of `files`. A section whose header matches no remaining entry is `internal`, never a mis-pairing; structural entries (added, deleted, renamed, mode or type changes) always have their sections, `-w` or not.
4. Per file: `Binary files … differ` → `binary: true`; hunks from `@@ -a,b +c,d @@ header`; lines kept verbatim (decoded as UTF-8 for the protocol; a file whose bytes are not valid UTF-8 is reported `binary: true`); `additions`/`deletions` from `+`/`-` lines; a file whose own sections exceed 512 KiB keeps counts and gets `tooLarge: true`, `hunks: []`.
5. **Response budget.** The result is sent as one JSON line, and the stdio transport closes a connection whose pending output passes 64 MiB (`stdio.ts:19,54-62`); parsed hunks are larger than their patch text (a zero-context one-line hunk is about 20 bytes of patch and 120 of JSON). So files are added in order while a running total of `Buffer.byteLength(JSON.stringify(file))` stays within 24 MiB; a file that would pass it is added as metadata only (`tooLarge: true`, `hunks: []`), and once metadata alone would pass 32 MiB the remaining files are not listed and `filesOmitted` counts them (both budgets come from `ThreadManagerOptions.diffBudgets` when a test sets it).
6. `hunkId = sha256(path + "\0" + <the file's extended header lines: rename, mode, new/deleted file, index> + "\0" + header + "\0" + lines.join("\n")).slice(0, 16)`, so a change in the file's structure (a new mode, a rename) gives every hunk of it a new id.

The handler runs in `thread.hold()`, without the repository lock (reads take no lock).

- [ ] **Step 1: Failing tests** — each states setup and exact expectations:
  - uncommitted: edit `a.txt` line 2, add `new.txt`: two files, `modified` with hunk lines `[" one", "-two", "+TWO", " three"]` and `added` with `["+untracked"]`; the real index's bytes are unchanged.
  - unstaged/staged: stage an edit of line 1, then edit line 3 in a 7-line file: `staged` has one hunk touching line 1, `unstaged` one touching line 3.
  - branch: a worktree thread edits `a.txt`; the user commits in the main checkout; the `branch` diff is identical before and after that commit.
  - `branch` on a local thread compares with its upstream; with `against: "main"` on a feature branch it shows the branch's commits and uncommitted edits; with no upstream and no default branch → `invalidParams`.
  - `committed` with a commit from `git/log` shows exactly that commit's change; a root commit shows every file added; no `commit` → `invalidParams`.
  - `ignoreWhitespace: true` hides a change that only re-indents a line; a revert with a hunk id from that read → `diffChanged`.
  - 501 untracked files in `gen/` plus one tracked edit: one file, `untrackedSkipped: 501`.
  - `context: 1000000` on a 7-line file with two edits: one hunk.
  - rename (`git mv`), delete, binary (bytes `\x89PNG\r\n\x1a\n\0`): statuses `renamed` (with `oldPath`), `deleted`, `modified` with `binary: true` and no hunks.
  - paths `a b.txt`, `ü.txt`, `-dash.txt`, `quote".txt` (POSIX only) each pair with their own hunks.
  - POSIX only: a file replaced by a symlink is one `typeChanged` file.
  - a worktree started with `carryLocalChanges` shows the carried edits in `uncommitted` and in `branch` before its first turn.
  - outside git → `notGitRepo`.
  - an unborn repository, SHA-1 and SHA-256 (`git init --object-format=sha256`), with one staged and one untracked file: `staged` lists the staged file, `uncommitted` both.
  - over real stdio (`stdio.test.ts`'s `spawnServer`): 30 files of 36,000 one-character lines with every other line changed, read with `context: 0`, so each change is its own hunk (about 26 bytes of patch, about 130 of JSON). The test first asserts its fixture: the whole `git diff -U0` is under 16 MiB and each file's section under 512 KiB (neither raw limit applies), while the files' hunks serialized would pass 24 MiB. Then: the response arrives; `files[0]` has all its hunks; a later file whose section is under 512 KiB is `tooLarge` with `hunks: []` (only the serialized budget explains it); a following `thread/diff/read` on the same connection succeeds.
  - with test budgets (`ThreadManagerOptions.diffBudgets: {serialized: 64 KiB, metadata: 96 KiB}`), 2,000 deleted files: the serialized `files` stays within 96 KiB and `filesOmitted` counts the rest.
- [ ] **Step 2:** Unit-test `splitPatch` with a recorded patch containing a quoted path, a rename, a two-section type change, `\ No newline at end of file`, and an empty added file.
- [ ] **Step 3–4:** Run (FAIL), implement, run, `bun run check-types`.

## Task 6: Turn change detection and `turn/diff/updated`

**Files:** Modify `diff.ts` (`TurnChanges`), `threads.ts` (`threadExtensions`, `afterSettle`), `item-mapper.ts` (`onSettled(turnId?)`), `loaded-thread.ts` (`changes`, `dispose`); test `packages/cli/test/app-server/turn-diff.test.ts`.

```ts
export const TURN_DIFF_ENTRY = "knightcode.turnDiff";
export interface TurnDiffRecord {
	turnId: string;
	before: string;
	after: string;
	files: string[];
}
export const turnChangeHooks = { afterSnapshot: async (_phase: "before" | "after") => {} }; // test gate only
export class TurnChanges {
	constructor(repo: Repo, record: (r: TurnDiffRecord) => void, notify: (r: TurnDiffRecord) => void);
	/** Awaited by every tool_call of a turn; the first starts the before-snapshot, the rest share it. */
	beforeTool(): Promise<void>;
	/** After settle: queue the after-snapshot (same untracked mode as before) on the thread's chain. */
	settled(turnId: string): void;
	/** Resolves when every queued snapshot finished and its record was handed to `record`. */
	close(): Promise<void>;
	/** The same wait without closing: revert, handoff and deletion call it after reserving the checkout. */
	idle(): Promise<void>;
}
```

- `LoadedThread.changes` is created in `build()` when `repoOf(cwd)` is a repository; otherwise `undefined` and nothing is ever sent.
- Hidden inline extension `app-server-turn-changes`, in `threadExtensions` *after* `createApprovalExtension(holder)` (a declined call never snapshots): `knightcode.on("tool_call", async () => { await holder.thread?.changes?.beforeTool(); return undefined; })`. A snapshot failure is logged to stderr and the turn continues without a diff event.
- One promise chain per thread runs every snapshot, so turn 2's "before" waits for turn 1's "after". Each snapshot has a 30 s timeout.
- `ItemMapper`'s `onSettled` becomes `(turnId?: string) => void`, `settled()` passes `turn.id`, and `afterSettle(thread, turnId)` calls `thread.changes?.settled(turnId)`.
- On a difference: `files = git diff --name-only -z <before> <after>`; `record` appends `knightcode.turnDiff` at once (custom entries are invisible to the model and to `readTurns`, and appending mid-run has precedent in `setApprovalMode`); a closed manager or lost lock skips with stderr. Then `notify` sends `turn/diff/updated {threadId, turnId, files}`, which therefore always follows `turn/completed`.
- `LoadedThread.dispose()`'s `finally` block runs, in this order: the forced `mapper.settled(true)` that already exists (`loaded-thread.ts:239`, which may queue a last after-snapshot), then `await this.changes?.close()`, then `unsubscribeSession()`, `session_shutdown` and `session.dispose()`. `close()` marks the tracker closed after its chain drains; a `beforeTool` or `settled` call after that does nothing, so no snapshot can start once the manager is closing.
- `scopeTrees(…, "lastTurn")` reads the newest `knightcode.turnDiff` entry on the branch.

- [ ] **Step 1: Failing tests** (the faux model calls `bash`; approval mode `fullAccess`):

```ts
test("a bash write emits turn/diff/updated after turn/completed; the user's index is unchanged", async () => {
	const s = await repoServer();
	const { thread } = await s.a.client.request("thread/start", { cwd: s.cwd, approvalMode: "fullAccess" });
	const index = readFileSync(join(s.cwd, ".git", "index"));
	s.faux.setResponses([
		fauxAssistantMessage([fauxToolCall("bash", { command: "echo hi > out.txt" })], { stopReason: "toolUse" }),
		fauxAssistantMessage([fauxText("done")]),
	]);
	await s.a.client.request("turn/start", { threadId: thread.id, text: "write" });
	const completed = await s.a.waitFor("turn/completed");
	const diff = await s.a.waitFor("turn/diff/updated");
	expect(diff).toMatchObject({ threadId: thread.id, turnId: (completed.turn as { id: string }).id, files: ["out.txt"] });
	const order = s.a.notifications.map((n) => n.method);
	expect(order.indexOf("turn/diff/updated")).toBeGreaterThan(order.indexOf("turn/completed"));
	expect(readFileSync(join(s.cwd, ".git", "index")).equals(index)).toBe(true);
});
```

  Further cases, each with exact expectations:
  - a second turn editing the file the first already modified: a second event with that file.
  - a text-only turn then a writing turn: exactly one event, carrying the second turn's id; exactly one `knightcode.turnDiff` entry.
  - `lastTurn` reads back after unload and resume.
  - a declined tool call (`ask`, decline): no entry.
  - three inputs queued with `turn/queue/add` while the first is held (`createHeldTurn`), each writing a different file: three entries in turn order, three events with the right files.
  - unload right after `turn/completed` while the after-snapshot is parked on `turnChangeHooks.afterSnapshot` (gate released in `finally`): after resume, the record is on the branch.
  - unload while an extension's `agent_settled` handler is parked on a gate (so `abort()` returns first and disposal's forced settle queues the after-snapshot): after resume, the record is on the branch, and no snapshot runs after `session.dispose()`.
  - outside git: no event, tools run.
- [ ] **Step 2–4:** Run (FAIL), implement, run with `turns.test.ts` and `queue.test.ts`, `bun run check-types`.

## Task 7: `thread/diff/revert` and review comments on `turn/start`

**Files:** Modify `diff.ts`, `threads.ts` (`startTurn`, `addQueued`), `item-mapper.ts` and `transcript.ts` (comments on the user item); test `packages/cli/test/app-server/diff-actions.test.ts`.

**Checkout reservations.** `ThreadManager.reservedCheckouts: Map<string, string>` (canonical checkout root → the operation holding it). Taking one is synchronous: it fails with `turnInProgress` if any thread loaded or loading in that checkout is busy or `draining` (`drainQueue` removes the input and sets `draining` before `startTurn` registers its pending start, `threads.ts:859-877`, and `busy` does not see that gap; `this.threads` and `this.loading`, matched by `repoOf` root cached per thread at load), or if the checkout is already reserved. While it is held: `startTurn` refuses to start a thread in that checkout (`turnInProgress`), and `drainQueue` checks the reservation in its guard, before `queued.shift()`, so a queued input stays queued until the release (which runs `afterActivity` for the affected threads) and a reservation never makes a dequeued input fail, and the server-owned `app-server-turn-changes` extension's `tool_call` handler blocks any tool call in that checkout (`{block: true, reason: "the checkout is being reverted, handed off or deleted; try again when it finishes"}`), which also covers runs an extension launches without `turn/start`. This is above the harness: admission is the manager's, and tools are gated through the existing extension hook. Right after taking a reservation, the operation awaits every entry of `this.closing` (threads that `transition()` already removed from `this.threads` but whose disposal, final snapshot included, may still run; `// ponytail: waits for every closing thread, not only those in the checkout; closings are short`) and then `changes.idle()` (the `TurnChanges` chain, without closing it) of every thread in the reserved checkouts, so a turn that just completed has its after-snapshot taken before anything in the checkout changes. Revert reserves its thread's checkout; handoff reserves both the worktree and the main checkout; a worktree deletion (Task 10) reserves the worktree.

**Revert** `{threadId, scope?, against?, commit?, path?, hunkId?, context?}` → `{paths}`:

1. `staged` → `invalidParams` ("unstage with git/unstage"); `committed` → `invalidParams` (a commit is not reverted from here); `hunkId` without `path` → `invalidParams`; a `path` that is not in the scope's diff → `invalidParams`; a change touching a submodule (`submodulePaths`) → `invalidParams`, before anything is written.
2. **Checkout reservation** (shared with Tasks 9 and 10): refused with `turnInProgress` when any loaded or loading thread whose cwd is inside this checkout is busy, checked synchronously together with taking the reservation (below); the work runs in `thread.exclusive()` and `withRepoLock(repo)`, and the reservation is released in `finally`.
3. Recompute the scope's diff with `context` (default 3). With `hunkId`, find it in `path`; missing → `gitConflict {reason: "diffChanged", paths: [path]}`.
4. **`lastTurn` only:** every affected path (the hunk's file, the file, or all of the record's files) must currently be exactly as the turn left it: `currentEntries(repo, paths)` equals `entriesOf(repo, after, paths)` (mode and object id; absent on both sides counts as equal). A later edit, `chmod`, retargeted symlink or deletion → `gitConflict {reason: "diffChanged", paths}`. Submodule paths were refused in step 1.
5. Patch from `machinePatch` (`binary: true`). Hunk actions are refused (`invalidParams` "revert or stage the whole file") for a file whose change is structural (one exception: `git/stage` of a hunk of an untracked file checks the `hunkId` against the current `unstaged` diff, `diffChanged` when stale, and then stages the whole file, Task 8): renamed or copied, added or deleted, a mode change, a type change (two sections), or binary. Their header lines carry operations of their own (`rename from/to`, `old mode/new mode`, `new file mode`), so "one hunk" of them would also rename, chmod or create the whole file. For an ordinary modified file a hunk is its `diff --git`, `index`, `---` and `+++` lines plus that hunk only; a file is its own sections (both paths of a rename); no path is the whole scope.
6. `machineApply(root, patch, {reverse: true, check: true})` then without `check` (working tree only). A failed check → `gitConflict {reason: "patchFailed", paths}` from `error: patch failed: <path>:<n>`, `error: <path>: does not exist in working tree`, `error: <path>: already exists in working directory`; nothing written.

Reverting an `added` file deletes it, an untracked one included: the client confirms with the user (documented).

**Review comments** travel with a turn, as in Codex, where they are drafts on the diff ("Local comment on line R2") that a "1 comment" chip carries into the next message. `turn/start` and `turn/queue/add` take `comments?: DiffComment[]`; the client keeps the drafts. Before the input is accepted, each comment's `path` must be in its scope's current diff (`invalidParams` otherwise), and its lines are quoted from that scope's trees, never the filesystem: `new` from `<to>:<path>`, `old` from `<from>:<oldPath ?? path>` (a renamed file's old side has its old name; `git cat-file blob`, raw bytes decoded as UTF-8), so the quote is what the reviewed diff showed even for `staged` and `lastTurn`. A side the file does not have (`old` of an added file, `new` of a deleted one), a binary file, `endLine < startLine` or a range past the end → `invalidParams`; at most 200 quoted lines and 16 KiB of quoted text per comment, and 256 KiB for the composed text (`invalidParams` past either: the queue notification carries the whole text, and the stdio transport closes the connection past 64 MiB of pending output, `stdio.ts:54-62`); each blob is read once per request. The model receives the composed text followed by the user's own text:

````text
Review comments on the changes:

`src/a.ts` lines 10-12 (new):
```
<the lines>
```
<body>
````

The comments are recorded too, but only for an input that actually becomes a user message: they travel with the start request as its `clientMessageId` does (`pendingClientMessageId`, moved to the new owner on a replacement, `threads.ts:1174-1179`), and are dropped when the input is handled or cancelled without one (`agent-session.ts:2182-2192`, the start guard at `threads.ts:764-773`). When `ItemMapper` appends that start's user item, it sets `comments` and the user's own `text` on the item and appends a `knightcode.turnComments` custom entry `{itemId, comments, text}` keyed by that item's id (`<turnId>:user:<n>`); `readTurns` applies an entry only to the item with that id, never to "the next user message". So the transcript shows the chip and not the composed block, also after a resume.

- [ ] **Step 1: Failing tests:** revert one of two hunks in a file keeps the other; revert a file restores its base content, and an untracked added file is deleted; a stale `hunkId` → `diffChanged` with the file unchanged; whole-turn undo restores the turn's files; a hunk revert or hunk stage of a renamed file with two hunks, of a file whose mode and content both changed, and of a file replaced by a symlink → `invalidParams`, nothing written; a file revert of the same files works; undo after the user edited a turn file → `diffChanged` and nothing written (including the repeated-block case: two identical blocks, the turn edited the first, the user undid it by hand and made the same edit in the second); revert while a held turn runs → `turnInProgress`; unload a thread while its after-snapshot is parked, then revert through a sibling thread in the same checkout: the revert waits, and the unloaded thread's record does not contain the revert; a revert sent right after `turn/completed` while that turn's after-snapshot is parked on `turnChangeHooks.afterSnapshot` waits for it: the turn's record still names the turn's change, and the revert's own change is not in it; `scope: "staged"` → `invalidParams`; a path not in the diff → `invalidParams`; with `core.autocrlf=true` and CRLF working files, a hunk revert round-trips; a `turn/start` with a comment on `staged` quotes the index version while the working file differs; a comment on `lastTurn` quotes the `after` content after the user edited the file; an old-side comment on a renamed file quotes the old name's content, also when a different file had the new name before; the user item of a turn with comments has `comments` and only the typed text, live and after unload and resume; a start with comments that an input handler handles (or that is interrupted in its input hook) leaves no `knightcode.turnComments` entry, and the next turn's user item has no comments; a queued input with comments keeps them until it runs; `scope: "committed"` revert → `invalidParams`; POSIX only: undo of a turn that created a symlink, and of one that replaced a file by a symlink, restores the previous state, and a symlink retargeted afterwards is `diffChanged`.
- [ ] **Step 1a: Comment budget:** over real stdio, a `turn/queue/add` with 50 comments each quoting the same 2 MiB line → `invalidParams`, nothing queued, and a following request on the connection succeeds; one comment quoting 200 short lines is accepted.
- [ ] **Step 1b: Queue admission:** with `drainQueue` parked between `queued.shift()` and the pending-start registration (test gate `queueHooks.afterDequeue`), a revert of that checkout answers `turnInProgress`, and the input runs exactly once; with a revert holding the reservation, a queued input stays queued (`turn/queue/updated` while the reservation is held, and `thread/resume`'s `queue.followUp`) and runs exactly once after the revert ends.
- [ ] **Step 2–4:** Run (FAIL), implement, run, `bun run check-types`.

## Task 8: `git/*`: status, stage, unstage, commit, push, pull request, branches, log

**Files:** Create `packages/cli/src/app-server/git-actions.ts`; modify `threads.ts` (handlers; `ThreadManagerOptions.ghCommand?: string` for tests); test `packages/cli/test/app-server/git-actions.test.ts`.

All act on the thread's checkout (`repoOf(thread cwd)`). None refuses a running turn. **Lifecycle (Tasks 5, 7, 8, 9 alike):** every new handler runs its work through `this.track()` (so `closeAll()` waits for it and a request arriving after shutdown began answers `shuttingDown`) and passes `this.shutdown.signal` to every child process (so shutdown kills a hung push, hook or `gh` and the operation ends). Mutations also run under `withRepoLock`; revert and handoff additionally run in `thread.exclusive()` (they refuse a running turn); the others hold the thread with `thread.hold()` only, so they never wait for a turn.

- `git/status`: `git status --porcelain=v2 --branch -z --untracked-files=normal`; `1`/`2` records count `staged` when X ≠ `.` and `unstaged` when Y ≠ `.`; `?` → `untracked`; `u` → `conflicted`; `# branch.head`, `# branch.upstream`, `# branch.ab +A -B`; `operation` from `MERGE_HEAD`, `rebase-merge`/`rebase-apply`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` in `repo.gitDir`.
- `git/stage {path?, hunkId?, context?}` (hunk actions here follow Task 7 step 5's structural refusal): none → `git add -A`; path → it must name a `git status --porcelain=v2 -z --untracked-files=all` record (`all`, so a file inside a new directory is its own record rather than the directory, whatever the user's `status.showUntrackedFiles`), and a rename or copy record acts on both its paths as one change (`git add -A -- <old> <new>`); hunk → from the `unstaged` scope, single-hunk patch from `machinePatch`, `machineApply(root, patch, {cached: true, check: true})` then without `check`; a hunk of an untracked file stages the file (git cannot stage part of a file the index does not know). Submodule changes are refused (`submodulePaths`).
- `git/unstage`: none → `git reset -q -- .` at the root (path-limited: a pathless reset is a mixed reset that deletes `MERGE_HEAD` and rewrites `ORIG_HEAD`; the path form keeps both and works on an unborn branch, probed 2026-10-17); path → as for stage, both paths of a staged rename (`git reset -q -- <old> <new>`: resetting only the new name leaves the old name's deletion staged, probed 2026-10-17); hunk → from `staged`, `machineApply(root, patch, {cached: true, reverse: true})` after its `check`. Both work on an unborn branch.
- `git/commit {message?, includeUnstaged?}`: with `includeUnstaged` (default true, Codex's "Include unstaged changes" checkbox, checked by default) everything is staged first exactly as `git/stage` with no target does (`git add -A`), before the capture below; with `false` only what is staged is committed. A `message` that is empty or only whitespace counts as absent (§6.3: "an empty commit message asks the thread's model for one"). Capture `head = git rev-parse -q --verify HEAD` (empty on an unborn branch → `null`), `ref = git symbolic-ref -q HEAD` (exit 1 on a detached `HEAD` → `null`) and `indexTree` first; the rechecks below compare these nullable values. Both states commit as git does: an unborn branch gets its root commit, a detached `HEAD` moves without touching any branch. `headTree` is `HEAD^{tree}`, or `emptyTree(repo)` when `head` is `null` (that is, `headTree(repo)`). Nothing staged (`indexTree = headTree`) → `invalidParams`. Without a message: `machinePatch(repo, headTree, indexTree, {})` truncated at 48 KiB (with a marker) goes to `ctx.models.completeSimple(model, {systemPrompt: COMMIT_PROMPT, messages: [{role: "user", content: [{type: "text", text: diff}], timestamp: Date.now()}]}, {maxTokens: 1024}, thread.session.resourceLoader.getExtensions().runtime)` (the owner argument makes session-scoped virtual models resolve, `model-runtime.ts:1037-1040`), outside the conversation, with `signal: AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(120_000)])` in the options (the public options carry a signal through virtual-model routing, `model-runtime.ts:727-740`), and the call itself is raced in app-server code against that signal (`Promise.race` with a promise rejected on abort; the losing completion's late settlement is consumed and ignored), because a session-owned virtual router may ignore the signal (`model-runtime.ts:1037-1058` and `lazyStream` await setup without racing it). After the race the signal is checked again before `git commit` runs, so a late answer never commits. Immediately before committing (with or without a generated message), `HEAD`, the symbolic ref and `indexTree` must equal the capture; otherwise `gitConflict {reason: "concurrentChange"}` and nothing is committed (a tool or an external `git add` during the two-minute generation must not slip into the commit). No model → `authRequired`; an aborted or error reply → `internal`. `COMMIT_PROMPT`: "Write a git commit message for this diff: a subject line under 72 characters, a blank line, then a short body only if the change needs explaining. Reply with the message only." Commit with `git commit -F -` (the user's hooks run); a hook failure → `internal` with its output.
- `git/push`: branch from `git symbolic-ref --short -q HEAD` (detached → `invalidParams`). Remote and destination: the branch's upstream when it has one (`branch.<b>.remote` and `branch.<b>.merge`), else remote `origin` if listed, else the only remote, else `invalidParams` "no remote", with destination `refs/heads/<branch>`. Always one explicit, non-forcing refspec: `git push --no-follow-tags --recurse-submodules=no [--set-upstream] <remote> refs/heads/<branch>:<destination>`, `--set-upstream` only when there was no upstream. An explicit refspec bypasses `remote.<name>.push` (a configured `+` force refspec) and `push.default=matching`. 5-minute timeout. `[rejected]` in stderr → `gitConflict {reason: "pushRejected", output}`; other failures → `internal`.
- `git/branches`: `git for-each-ref --format=%(refname:short) refs/heads` (sorted by committer date, newest first), `current` from `git symbolic-ref -q --short HEAD`, `defaultBranch` as in Task 5's `branch` scope.
- `git/branch/create {name}` (Codex's "Create branch here", which turns a detached worktree into a branch): `git check-ref-format --branch <name>` or `invalidParams`; an existing name → `gitConflict {reason: "branchExists"}`; `git switch -q -c <name>` (the user's hooks run). Uncommitted changes stay where they are.
- `git/branch/switch {name}`: the name must be a local branch from `git/branches`. Git refuses a switch that would overwrite local changes, but not one that overwrites an ignored file the branch tracks, so first Task 9's ignored-file check runs on `git diff --name-only --no-renames -z HEAD <name>` (an ignored or untracked entry at a written path or an ancestor of one → `gitConflict {reason: "localChanges", paths}`, nothing changed). Then `git switch -q <name>` (no `--force`, no `--merge`; git's own refusal comes back as `gitConflict {reason: "localChanges", output}`); a branch checked out in another worktree → git's refusal, the same way.
- `git/log {limit?}` (default 50): the commits of the current branch that are not on its base, `git log -z --format=%H%x00%s%x00%an%x00%ct <base>..HEAD -n <limit>`, `base` being the worktree's `baseRef` for a worktree thread, else the merge base with the default branch (Task 5), else all of `HEAD`'s history. This is the list Codex's "Committed" source picks from.
- `git/pr/create {title?, body?, draft?}`: both `title` and `body` missing → `["pr", "create", "--head", branch, "--fill"]`; otherwise `--title` (given, else the branch's last commit subject, `git log -1 --format=%s`) and `--body` (given, else `""`), so a given body is never dropped; `draft: true` appends `--draft` in both forms. Run as `runProcess(options.ghCommand ?? "gh", args, {cwd, timeoutMs: 120_000, signal: this.shutdown.signal})`; `toolMissing` from `runProcess`; the URL is the last stdout line starting with `https://`, else `internal` with the stderr tail.

- [ ] **Step 1: Failing tests** (a bare repository in a temp dir is `origin`): status counts and ahead-of-upstream; stage and unstage one hunk; stage a hunk of an untracked file stages the file, and a stale `hunkId` of one answers `diffChanged`; `git/stage {path: "a[1].txt"}` with `a1.txt` also present stages only `a[1].txt`; commit with a message runs the user's `commit-msg` hook (it appends a trailer); commit without a message, and with `message: "  "`, uses the faux reply as the message and adds no turn to the thread; commit without a message on a thread whose model is a session-owned virtual model registered by an extension succeeds; with `includeUnstaged` (the default) an unstaged edit and an untracked file are committed, with `includeUnstaged: false` only the staged file is; nothing to commit → `invalidParams`; `git/branch/create` on a detached worktree makes the branch and keeps the uncommitted edit, an existing name → `branchExists`; `git/branch/switch` to a branch that would overwrite a local edit, or an ignored `.env` the branch tracks → `localChanges`, nothing changed; `git/branches` lists newest first with `current`; `git/log` in a worktree lists only the thread's commits since `baseRef`; push sets upstream the first time and pushes plainly the second; with `remote.origin.push=+refs/heads/*:refs/heads/*` and `push.default=matching` configured, a push updates only the thread's branch, other local branches ahead of `origin` stay unpushed, and a non-fast-forward is `pushRejected`; shutdown while a fake `gh` (a `ghCommand` script that waits forever) runs makes `closeAll()` resolve, the script's process is gone, and nothing is written afterwards; staging and then unstaging a rename (`git mv a.txt b.txt`) by its new path leaves nothing staged; during a non-conflicting `git merge --no-commit`, unstage all leaves `MERGE_HEAD`, `ORIG_HEAD` and the working files as they were and `git commit` then still makes a merge commit; unstage all on an unborn branch unstages everything; commit on an unborn branch makes the root commit (also without a message: the generated diff is against the empty tree); commit on a detached `HEAD` makes a commit and moves no branch; with message generation parked on a gate, staging another file externally (or switching branches) makes the commit answer `concurrentChange` with no new commit; staging `new/one.txt` while `new/two.txt` is also untracked stages only `new/one.txt`; `git/pr/create` with only `body`, only `title`, both, neither, and each of those with `draft: true` passes exactly what was given (a fake `ghCommand` script records its arguments); shutdown during a commit-message request that never answers (a faux provider gated not to reply) ends the request and `closeAll()` resolves, also when the thread's model is a session-owned virtual model whose router never resolves and ignores its signal; a rejected push → `pushRejected`; `ghCommand` pointing nowhere → `toolMissing`.
- [ ] **Step 2–4:** Run (FAIL), implement, run, `bun run check-types`.

## Task 9: `thread/handoff` between the worktree and the main checkout

**Files:** Modify `workspaces.ts` (`handoff`), `threads.ts` (handler, reload); test `packages/cli/test/app-server/handoff.test.ts`.

Codex's "Move to main checkout" and its reverse: the chat and its uncommitted changes move together, and the thread keeps its worktree for a later handoff back. `thread/handoff {threadId, to, branch?, environment?}`; the main checkout is the project's repository root (`requireRepo(projectCwd)`), the worktree is the one `placeThread` associates with the thread. The handler runs in three phases, so that no phase waits on a lock or queue it already holds:

**Phase A: prepare the destination** (to worktree only; no repository lock held). For a thread with no associated worktree (born in the main checkout): pre-check step 0's refusals for the main checkout, then the public `createWorktree` (which takes and releases the repository lock itself) at the main checkout's `HEAD`, followed by Task 3's `.worktreeinclude` and setup with the request's `environment`, and `placement[threadId] = "worktree"` is *not* written yet. An associated worktree that was deleted is restored first with the public restore (Task 10, which also takes and releases the lock). A worktree created here and then refused in Phase B is left for pruning.

**Phase B: move the changes**, holding both checkout reservations (Task 7: refused with `turnInProgress` while any thread loaded or loading in either is busy or draining; no turn starts and no tool runs in either until the handoff ends), inside `thread.exclusive()` and `withRepoLock(repo)`, taken once:

0. **Refusals** before anything is written:
   - `to: "local"` for a thread that is not running in a worktree, or `to: "worktree"` for one that is → `invalidParams`.
   - `gitConflict {reason: "operationInProgress"}` when `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD`, `rebase-merge` or `rebase-apply` exists in either checkout's git dir, or `git ls-files -u` is non-empty in either.
   - **The destination must be clean:** `git status --porcelain=v1 -z --untracked-files=normal` is empty there, else `gitConflict {reason: "localChanges", paths, recoveryInstructions: ["Stash or commit your local changes to hand off."]}` (Codex's wording; observed for a tracked edit and for an untracked file alone).
   - **Nothing ignored in the way.** Ignored files may stay in the destination, but git's checkout overwrites an ignored file that a tracked file replaces (`git-checkout` documentation), and the patch's new files would too. Each checkout makes exactly one move, from its current `HEAD` to `sourceHead` (steps 4 and 3 below), so `written` = `git diff --name-only --no-renames -z <destination HEAD> <sourceHead>` plus the patch's paths (step 1) is every path either writes. For each, the path itself and each of its ancestor directories inside the root must not exist on disk as an untracked or ignored entry (`git ls-files -z --others --ignored --exclude-standard --directory -- <path and ancestors>`, and `lstat` for an ancestor that is a file where the change needs a directory), else `gitConflict {reason: "localChanges", paths, recoveryInstructions: ["These ignored files would be overwritten by the handoff. Move them away first."]}`.
   - The main checkout on an unborn branch → `invalidParams` "commit something in <root> first".
   - A thread with no session file yet (no user or assistant message: the harness writes the file only then, `session-manager.ts:1256-1273`, and Phase C's reload finds a thread by its file, `threads.ts:490-492`) → `invalidParams` "send a message before handing off". (In Phase A this check runs first, before a worktree is created.)
   - A submodule change among the moved changes (`submodulePaths(source, HEAD^{tree}, snapshotTree(source, true))`) → `invalidParams`.
1. **Capture** in the source checkout: `sourceHead = rev-parse HEAD`, `staged = git diff --cached --name-only --no-renames -z` (both ends of a staged rename, so the cleanup's reset never leaves the old path's deletion staged) (paths staged at capture), `patch = machinePatch(source, HEAD^{tree}, snapshotTree(source, true), {binary: true})` (the working state: edits and untracked files; ignored files stay, as in Codex) and `stagedPatch = machinePatch(source, HEAD^{tree}, indexTree(source), {binary: true})`. Both are saved to `<agentDir>/handoff/<threadId>-<Date.now()>.patch` and `….staged.patch` before anything moves, so neither the working state nor a staged version that differs from it can be lost. (Step 0's `written` uses `patch`'s paths, so capture's two `machinePatch` calls run before the ignored-file check; nothing is written by either.)

**To local** (the thread runs in its worktree):

2. **Branch.** `wtBranch = git symbolic-ref -q --short HEAD` in the worktree (set by `git/branch/create`, else none). The target is `wtBranch`, else the request's `branch`, else the manifest's `handoffBranch` when it still exists and is an ancestor of `sourceHead` (a second handoff after a round trip), else `<branchPrefix><slug>` where `slug` is the thread's name (or its first user message) lower-cased, runs of characters outside `[a-z0-9]` turned into `-`, trimmed of `-`, at most 40 characters (`codex/change-two-to-two-in` in the observed dialog); `git check-ref-format --branch` or `invalidParams`. A new name (not `wtBranch`, not the reused `handoffBranch`) that already exists as `refs/heads/<name>` → `gitConflict {reason: "branchExists"}`.
3. **Keep a detached main checkout's commit, then free the branch.** When the main checkout is on a detached `HEAD` that is not an ancestor of `sourceHead`, `git update-ref refs/knightcode/kept/main/<Date.now()> <that HEAD>` first and add a `server` warning naming the commit, so switching away never leaves it unreachable. With `wtBranch`: `git checkout -q --detach` in the worktree (`internal`; same commit, files untouched), because git checks a branch out in one place only.
4. **Check out in the main checkout** (`internal`), always as one move from the current `HEAD` straight to `sourceHead`, so step 0's ignored-file check (current `HEAD` → `sourceHead`, plus the patch) covers every file git writes: a new target → `git switch -q -c <target> <sourceHead>`; an existing one (`wtBranch`, whose tip is `sourceHead`, or the reused `handoffBranch`, an ancestor of it, both checked in step 2) → `git switch -q -C <target> <sourceHead>`, which moves the branch forward and checks it out without passing through its old tip. The checkout was clean and step 0 found nothing ignored in the way, so neither loses anything. A failure switches the main checkout back to the branch (or detached commit) it was on, re-attaches the worktree (`git switch -q <wtBranch>`, when step 3 detached it) and answers `internal` with git's stderr; nothing moved.
5. **Apply** `await workspaceHooks.beforeHandoffApply()`, then `machineApply(mainRoot, patch, {check: true})` and without `check`. The main checkout is clean at `sourceHead`'s tree, so the patch applies; a failure (I/O, a racing writer) → `gitConflict {reason: "recoveryRequired", recoveryInstructions: ["<target> is checked out in <main>, but the uncommitted changes could not be applied there. They are still in the worktree and in <patchPath>."]}`, the worktree untouched.
6. **Remove from the source:** `machineApply(worktree, patch, {reverse: true})`, then `git reset -q -- <the patch's paths and staged>` (path-limited, so the index of those paths returns to `HEAD` and nothing else changes; the staged versions are in `stagedPatch`). A failure adds a `server` warning naming the paths (the changes now exist in both places), never an error, and the result does not claim a clean source.
7. **Record:** `placement[threadId] = "local"`, `handoffBranch = target`, `writeManifest`.

**To worktree** (the thread runs in the main checkout):

2. **Keep the worktree's own commits.** The destination worktree (prepared in Phase A, or the associated one) can hold detached commits a sibling chat made there. When its `HEAD` is not an ancestor of `sourceHead` (`git merge-base --is-ancestor`), `git update-ref refs/knightcode/kept/<bucket>/<Date.now()> <worktree HEAD>` first, and the result carries a `server` warning naming that commit, so nothing becomes unreachable.
3. **Move the worktree:** `git --work-tree=. checkout -q --detach <sourceHead>` in the worktree (`internal`, `noFilters`, as creation populates; step 0 checked the worktree clean and nothing ignored in the way).
4. **Apply** in the worktree (`check`, then apply); a failure → `recoveryRequired` naming the patch, the main checkout untouched.
5. **Remove from the main checkout:** reverse-apply and the path-limited reset, as in step 6 above; a failure adds a `server` warning. The main checkout stays on its branch, which a later handoff to local fast-forwards (step 4 above).
6. **Record:** `placement[threadId] = "worktree"` for a thread born in the main checkout; for a handed-off worktree thread the entry is deleted (its header cwd is the worktree again). `writeManifest`.

**Phase C: move the thread.** After `thread.exclusive()` returned and the repository lock is released, still holding the two checkout reservations (so no turn can start in either checkout in between), the thread is reloaded where it now runs: `unload(threadId, "resume", undefined, {waitForQueue: false})` (the path a replacement already uses, `threads.ts:1195`; its after-snapshot is drained by disposal, Task 6), then `ensureLoaded`, which opens it with `placeThread`'s cwd. The relocation carries what the old `LoadedThread` held, as a replacement does (`threads.ts:1187-1194`): before the unload it takes `old.queued` (inputs accepted while the reservations held them back, Task 7, with their ids, order, `by` and comments), `old.subscribers` and `old.lastTurnSubscriber`; after the load it subscribes the same subscribers to the new thread, appends the entries to `next.queued` in order, sets `lastTurnSubscriber`, sends `thread/replaced {oldThreadId: <same id>, thread}` (so clients pick up the new cwd and workspace) and `turn/queue/updated`. Then the reservations are released, which runs `afterActivity` and so the queued inputs start in their new checkout. The result is `{thread, branch?, warnings}`; the worktree stays registered.

The handoff runs no hooks (`internal`, as Codex's git steps do): it moves the user's own work and creates no commit.

- [ ] **Step 1: Failing tests** (each "unchanged" is `checkoutState` equality):
  - to local: the worktree thread commits `c.txt` and leaves an edit of `a.txt` and an untracked `n.txt`; handoff → the main checkout is on `kc/<slug>` at the worktree's `HEAD` (it has `c.txt`), `a.txt` and `n.txt` are uncommitted there (`git status --porcelain` is ` M a.txt` and `?? n.txt`), the worktree is clean (`git status --porcelain` empty), detached at the same commit and still registered, `thread.cwd` is the main checkout, `thread.workspace` is `{mode: "local", worktree: <path>}`, and `say()` runs a turn there.
  - a staged rename `a.txt → b.txt` whose working file was moved back to `a.txt` (empty working patch): after the handoff the worktree's index has neither the rename nor `a.txt`'s deletion staged.
  - a staged edit in the worktree that was edited again after staging: the main checkout gets the working version, the worktree's index and files are back at `HEAD`, and the `.staged.patch` file holds the staged version.
  - the main checkout with a tracked edit, with only an untracked file, and with a staged file → `localChanges`, both checkouts unchanged; with only an unrelated ignored file → the handoff succeeds and the ignored file is untouched.
  - the main checkout has an ignored `.env` and the worktree's commit tracks `.env` → `localChanges` naming `.env`, both checkouts unchanged; the same for an ignored file `cache` where the change adds `cache/x.txt`.
  - a worktree on a branch made with `git/branch/create {name: "feat/x"}` → the main checkout is on `feat/x`, the worktree is detached; `branch: "custom"` is used when the worktree has no branch; an existing `custom` → `branchExists`, both unchanged.
  - a merge in progress in the main checkout → `gitConflict {reason: "operationInProgress"}`.
  - `workspaceHooks.beforeHandoffApply` makes the patch fail to apply (it writes a conflicting `a.txt` into the main checkout) → `recoveryRequired` naming the patch file, which exists; the worktree unchanged.
  - round trip: to local, the thread edits `a.txt` in the main checkout, to worktree → the edit is uncommitted in the worktree, the main checkout is clean on `kc/<slug>`, `thread.workspace.mode` is `worktree`; the thread commits in the worktree; to local again → the branch is fast-forwarded to the new commit, no `branchExists`; the same after the user switched the main checkout to `main` in between (the handoff switches to `kc/<slug>` and fast-forwards it).
  - a sibling chat sharing the worktree commits there while the owner runs locally; the owner hands off back → `refs/knightcode/kept/<bucket>/…` points at the sibling's commit and a warning names it.
  - a thread born in the main checkout, to worktree, to local, to worktree: the second handoff to worktree reuses the first worktree (same path), and in between `thread.workspace` is `{mode: "local", worktree: <that path>}`; after a restart the thread resumes where it was last placed.
  - a handed-off thread resumes in the main checkout after a server restart; `thread/list` shows it `local` under the project.
  - a busy sibling thread in the worktree, or a busy local thread in the main checkout → `turnInProgress`, nothing changed.
  - a `turn/queue/add` accepted while the handoff is parked in Phase B (`workspaceHooks.beforeHandoffApply`) runs exactly once after the handoff, in the main checkout, and the subscriber that added it receives its turn notifications.
  - the main checkout detached at a commit of its own: to local keeps it under `refs/knightcode/kept/main/…` and warns; an ignored `.env` tracked by the reused handoff branch's old tip but by neither the main checkout's `HEAD` nor `sourceHead` is untouched.
  - POSIX: a path with a tab in its name moves intact.
  - a handoff whose source has commits but no uncommitted changes moves the branch and answers success (the empty patch is a no-op); a fresh thread with no message → `invalidParams`, nothing created.
  - a worktree thread started in `pkg/` hands off to local and runs in `<main>/pkg`, and back in `<worktree>/pkg`.
- [ ] **Step 2–4:** Run (FAIL), implement, run, `bun run check-types`.

## Task 10: Worktree deletion with snapshots, pruning, restore, `worktree/list` and `worktree/delete`

**Files:** Modify `workspaces.ts` (`deleteWorktree`, `restoreWorktree`, `pruneWorktrees`, `registrationOf`, `listWorktrees`), `threads.ts` (`archive`, `load`, `loadSaved`, a `worktreeUsers` registry, handlers); test `packages/cli/test/app-server/worktree-archive.test.ts`.

- **Users and the deletion fence.** `ThreadManager.preparing: Set<string>` holds thread ids whose worktree is being prepared: a start or worktree fork adds its new id before `createWorktree` and removes it once `load()` has registered the thread in `worktreeUsers` (or the call failed); a handoff adds the thread's id at the start of Phase A and removes it after Phase C. `preparing` also holds manifest paths: `thread/worktree/restore` adds the manifest's path before it starts rebuilding and removes it once `load()` has registered the restored thread in `worktreeUsers` (or the restore failed), whichever thread (owner, placed or sibling) asked for it. A manifest whose path, owner or any `placement` key is in `preparing` is fenced like one in use, so `.worktreeinclude`, setup and the load never run in a worktree that pruning picked meanwhile. `ThreadManager.worktreeUsers: Map<string, Set<string>>` (manifest path → thread ids loaded or loading there) and `ThreadManager.deleting: Map<string, Promise<void>>` (manifest path → a deletion in progress). `load()` adds the id to `worktreeUsers` synchronously before its first await when `placeThread` gives a manifest, then awaits `deleting.get(path)` (if any); the id is removed when the build fails or the thread is disposed. A deletion checks `worktreeUsers` and the checkout reservations and sets `deleting` in the same synchronous step, before its first await. So a loader that registered first makes the worktree `inUse`, and one that registers after waits and then finds it deleted (`worktreeDeleted`): no load ever builds in a directory being removed. A deletion never runs inside a closing transition (see Archive), so it waits only on `changes.idle()` of threads in the worktree and on `closing` entries of threads whose cwd is in it, none of which can be waiting on the deletion.
- **Registration.** `registrationOf(manifest)`: in `manifest.projectCwd`'s repository (whose `commonDir` must equal `manifest.commonDir`), the `git worktree list --porcelain -z` record whose `worktree` is `manifest.path` (canonical comparison), with a `.git` file whose administration directory points back to it (the crate's backlink check, `lib.rs:230-252`). None → not ours.
- **`deleteWorktree(manifest, reason)`**, public wrapper taking the repository lock (`deleteWorktreeLocked` for callers that hold it):
  1. The fence above; `inUse` when it holds. Then the manifest is read again under the lock: already `deleted` without `removalFailed` → nothing to do, and the existing `deleted` (its snapshot included) is the answer; `removalFailed` → step 2's nested-repository check (on a fresh `snapshotTree(wt, true)` and the real index), then the retry rule below, then step 6.
  2. **Submodules and nested repositories:** a snapshot records a nested repository as a gitlink only, not its files or its commits. So the working-state tree is computed first (`snapshotTree(wt, true)`, kept for step 4) and the worktree is never deleted when it holds a nested repository: that tree or the real index (`git ls-files -s -z`) has a mode-`160000` entry whose directory has a `.git` entry (an initialized submodule, one removed from the index with `git rm --cached`, or a repository that was never added, which `git add -A` turns into a gitlink), or a walk of the worktree (`readdir` from the root, never following links, not descending into directories `git check-ignore --stdin -z` reports as ignored) finds a `.git` file or directory anywhere below the root, such as a repository initialized inside a directory the outer repository already tracks, whose files the snapshot still records as ordinary tracked files while its commits are in its own `.git`. In that case: archive and prune skip it (`{deleted: false, reason: "submodules"}`), and `worktree/delete` answers `gitConflict {reason: "submodules", paths}` ("Remove or commit the nested repositories' work, then delete the worktree."). Creation never initializes submodules (`--no-recurse-submodules`), so this only concerns ones the user or the agent initialized or created; an ignored nested repository is dropped like every ignored file.
  3. No registration or no directory → `deleted = {reason, at}` without a snapshot (nothing to keep), done. A registration that is not ours (`notManaged`) → nothing is touched.
  4. **Snapshot**, unless the manifest already records one from an earlier attempt whose removal failed (`deleted.removalFailed`): then that snapshot is kept as it is, never replaced by the partly removed checkout's contents. Otherwise: `index = git commit-tree <indexTree(wt)> -p <HEAD> -m "KnightCode worktree index: <reason>"` (the staged state, including a staged file whose working copy was deleted) and `snapshot = git commit-tree <the step-2 tree> -p <HEAD> -p <index> -m "KnightCode worktree snapshot: <reason>"` (the working state: tracked and untracked files, not ignored ones; `assume-unchanged` edits and edited materialized `skip-worktree` files included, Task 0), with `GIT_AUTHOR_NAME`/`EMAIL` and `GIT_COMMITTER_NAME`/`EMAIL` set to `KnightCode`/`knightcode@localhost` in the process env (a repository without an identity still works); `git update-ref refs/knightcode/snapshots/<bucket>/<at> <snapshot>` (one ref per deletion, so a later snapshot never makes an earlier one unreachable; `gc` keeps both commits); `deleted = {snapshot, reason, at}` is written to the manifest *before* the checkout is touched.
  5. **Cleanup script** (Task 3) when the manifest names an environment and the project is trusted.
  6. Before removing, the verified administration directory (`git rev-parse --path-format=absolute --git-dir` in the worktree, the one `registrationOf` checked) is saved as `deleted.adminDir`. Then `git worktree remove --force <path>` (`internal`: uncommitted and untracked work is in the snapshot; ignored files are dropped, as in Codex), then the empty checkout directory; the bucket and manifest stay. A failure (a file held open on Windows) sets `deleted.removalFailed = true`, first restores what git needs to see the checkout if the removal already took it (below), and records `deleted.afterFailure`, the state right after the failed attempt (`HEAD`, `indexTree`, `snapshotTree(wt, true)`; a partial removal included), keeps the snapshot and its ref, and adds a `server` warning. A worktree in that state counts as deleted: a resume answers `worktreeDeleted`. A retry (archive, prune or `worktree/delete`), and a restore that must finish the removal first, recompute that state: step 2's nested-repository check first (a repository created after the failure is refused like one found on the first attempt); then unchanged → step 6; changed (the user worked in it after the failure) → that newer state is snapshotted as in step 4 under another ref, `refs/knightcode/snapshots/<bucket>/<now>`, appended to `deleted.later`, and named in a `server` warning, and only then step 6 runs. Restore rebuilds from the original snapshot (complete, made before anything was removed) and its result warns with the later snapshot refs, so no state is ever unreachable.
  - **A partly removed checkout.** Every step that reads git state in a `removalFailed` worktree (recording `afterFailure`, the retry's comparison and nested-repository check, restore's preliminary removal) first checks it: the checkout directory gone entirely → nothing is left to inventory, `git worktree remove --force <path>` from the main checkout drops the registration (it works on a missing path, probed), and the original snapshot is kept; the directory present but its `.git` file gone (`git worktree repair` cannot recreate one, probed 2026-10-18) → only when `deleted.adminDir` still exists and its `gitdir` file names `<path>/.git`, the server writes `<path>/.git` back as `gitdir: <adminDir>` (probed: status and the uncommitted edit are visible again), then continues; otherwise nothing is touched and a `server` warning names the path and the snapshot.
- **Archive.** Worktree deletion is separate from the transcript move and runs *after* the archive's closing transition has settled (so it never waits on its own `closing` entry, and two archives never wait on each other). Today `archive()` returns early when the file is already where it should be (`threads.ts:350-353`); with Phase B, an archive of an already archived thread that is loaded still unloads it and runs the deletion below. For a thread with a manifest (its own worktree, or the one it was handed off from): `autoDelete` off → `{deleted: false, reason: "autoDeleteOff"}`; another thread that is not archived still uses the worktree (in `worktreeUsers`, or listed with a cwd inside it or a `placement` there) → `{deleted: false, reason: "inUse"}`; else `deleteWorktree(manifest, "archive")` → `{deleted: true, snapshot}`. A resume of the archived thread that registers before the deletion's fence makes it `inUse`, and the worktree stays. Unarchiving does not restore it; `thread/worktree/restore` does.
- **Pruning** (`pruneWorktrees`, after every worktree creation and every archive, in `this.track`, errors to stderr): with `autoDelete`, the manifests under `settings.root` that are not `deleted`, sorted by `lastUsedAt`; while more than `keep` remain, delete the oldest whose fence does not hold (`reason: "prune"`). A worktree whose threads are not archived is pruned too: the snapshot keeps its work, and resuming offers a restore (as in Codex).
- **Restore** (`thread/worktree/restore {threadId}`; public wrapper taking the repository lock, as Task 9's Phase A uses it): the manifest's `deleted.snapshot` must exist (`git cat-file -e`), else `gitConflict {reason: "worktreeMissing", recoveryInstructions: ["Fork this chat into a new worktree to continue."]}` (a worktree deleted without a snapshot because its directory was already gone). With `removalFailed`, step 6 of the deletion runs first. Then, as creation does (Task 2): `git worktree add --detach --no-checkout <path> <snapshot^1>`, the destination's `config.worktree` pinned, `git --work-tree=. reset -q --hard --no-recurse-submodules <snapshot>` (`noFilters`) so the files are the working state, then `git reset -q --soft <snapshot^1>` so the detached `HEAD` is the original commit again (files untouched), then `git --work-tree=. read-tree <snapshot^2^{tree}>` so the index is the staged state again: edits and untracked files are back as they were, staged ones staged. Clear `deleted`, `lastUsedAt = now`. A failure removes the registration it made. Then the thread loads and the result is `{thread}`.
- **`worktree/list {cwd?}`** (Codex's Settings > Worktrees list): the managed manifests (of `cwd`'s project when given), each with `path`, `projectCwd`, `head` and `branch` from its registration (absent when deleted), `threadIds` (the owner, every thread whose cwd from `thread/list` lies inside it, and its `placement` keys), `lastUsedAt`, `deleted`. "New chat in this worktree" is `thread/start {cwd: <path>}`.
- **`worktree/delete {path}`:** `deleteWorktree(manifestFor(path), "user")`; `inUse` → `gitConflict {reason: "worktreeInUse"}`; not managed → `invalidParams`.
- **Load lifetime.** In `loadSaved`, everything between `SessionManager.open` and the build (registration in `worktreeUsers`, waiting on `deleting`) runs in one `try`: any failure closes the manager (releasing the transcript lock) and removes the id from `worktreeUsers` before rethrowing. Once `build()` starts, its existing cleanup owns the manager (`threads.ts:733-746`).

- [ ] **Step 1: Failing tests:** archive deletes a worktree holding a commit, a staged edit edited again afterwards, a staged new file whose working copy was then deleted, an untracked file and an ignored file: `refs/knightcode/snapshots/<bucket>/<at>` points at a commit whose first parent is the worktree's `HEAD`, the checkout directory is gone, the manifest has `deleted`; `thread/resume` → `worktreeDeleted`, `thread/read` still works; `thread/worktree/restore` → the worktree is back at the same path, detached at the old `HEAD`, `git diff --cached` and `git diff` equal what they were before the archive, the untracked file is untracked, the ignored file absent, and the thread loads; an edited materialized `skip-worktree` file survives archive and restore; archive with `autoDelete: false` keeps it (`autoDeleteOff`); archive of the owner while a plain fork in the same worktree is not archived → `inUse`; two sibling threads of one worktree archived at once both settle, and the worktree is deleted once; archive while a sibling's load is parked in an extension factory (`createGate`) → `inUse`, and the sibling loads; a sibling resume started while the deletion is parked after its fence (`workspaceHooks.afterUserCheck`) waits, then answers `worktreeDeleted`; pruning with `keep: 2` and three worktree threads deletes the least recently used one (with a snapshot) and never a loaded one; the environment's cleanup script runs before removal with both path variables, and a failing one still deletes and warns; `worktree/list` shows each worktree with its threads and `deleted`; `worktree/delete` of a loaded thread's worktree → `worktreeInUse`; a user's own `git worktree add` beside the managed ones, and the user's own stale registration, survive every deletion and prune; a manifest whose `path` was replaced by an unrelated directory registered elsewhere → `notManaged`, nothing removed; a malformed manifest → the thread is local and nothing is removed; a worktree with an initialized submodule holding an edit, with a submodule removed from the index by `git rm --cached`, with a nested repository never added (its own `.git` and a commit), and with `git init` run inside an already tracked directory followed by a commit there, is each skipped by archive and prune (`submodules`) and refused by `worktree/delete`, its files and commits intact; the cleanup script after a server restart gets the same two paths setup got, also for a worktree made by forking a thread that ran in another worktree's subdirectory; with `keep: 1`, a second start while the first is parked in setup (`workspaceHooks.beforeInclude`) never prunes the first one's worktree, and a prune that runs while a sibling thread's `thread/worktree/restore` is between rebuilding and loading never deletes the restored worktree; Windows only: a file held open in the worktree makes the removal fail, `deleted.removalFailed` is set, a resume answers `worktreeDeleted`, a retry after the file is closed removes the rest without a new snapshot, and a nested repository created in the worktree after the failed removal makes the retry and the restore refuse (`submodules`) with its files and commits intact, and restore brings back the original state; an edit made in the worktree between the failed removal and the retry is saved under a second snapshot ref named in a warning before the retry removes anything; a failed removal that already deleted `<path>/.git` gets it written back from `deleted.adminDir`, and one that deleted the whole directory finishes with the original snapshot kept; `worktree/delete` of an already deleted worktree answers its existing snapshot and restore still works.
- [ ] **Step 2–4:** Run (FAIL), implement, run with `thread-methods.test.ts` and `archive-publication.test.ts`, `bun run check-types`.

## Task 11: Docs, changeset, schema and validation

**Files:** `packages/cli/docs/app-server.md` (a "Workspaces, diffs and git" section before "Method reference"; one reference entry per new method with errors and a JSON example, in the `thread/delete` entry's style; the user-confirmation note for reverting added files); `packages/cli/docs/settings.md` (`worktrees.root`, `autoDelete`, `keep`, `fetchBeforeCreate`, `branchPrefix`; `.knightcode/environments.json` and `.worktreeinclude`); `apps/desktop/docs/desktop-app/architecture.md` §10 Phase B done-note and §13 record; `.changeset/<branch>.md` via `bun run changeset added minor`: "Added worktree threads, environments, scoped diffs, turn change notifications, git actions and handoff between worktrees and the main checkout to the app server."

- [ ] **Step 1:** Docs as above. Regenerate the schema; a second regeneration leaves `git diff --exit-code packages/cli/docs/app-server.schema.json` clean.
- [ ] **Step 2: Validation:**

```bash
bun run check-types
cd packages/app-server-protocol && bun x vitest --run
cd packages/cli && bun x vitest --run test/app-server/
bun x prettier --check "packages/app-server-protocol/**/*.ts" "packages/cli/src/app-server/**/*.ts" "packages/cli/test/app-server/**/*.ts"
bun run scripts/changelog-sections.ts
rg -n "from \"@knightcode/(ai|agent)\"" packages/app-server-protocol/src          # no matches
rg -n "exec\(|execSync\(|shell: true" packages/cli/src/app-server                  # no matches
rg -n "spawn\(" packages/cli/src/app-server                                       # git.ts (runProcess) and file-search.ts only
git diff --stat origin/main -- packages/agent packages/ai packages/cli/src/core   # empty: harness untouched
```

- [ ] **Step 3:** Record in architecture.md §13: Windows and WSL2 runs of `test/app-server/`, the git version, and the time of a `thread/diff/read` and a turn snapshot on this repository (about 3,000 tracked files).
- [ ] **Step 4: Codex parity check.** With the desktop shell's S2/S3 panes, or the in-process client where a pane does not exist yet, repeat the 2026-10-17 walk in a throwaway repository: worktree start with an environment, Changes scopes, a comment sent with a turn, commit with a generated message, fork in a new worktree, move to the main checkout (refused while dirty, then done), archive and restore. Each step behaves as the "Codex parity" table says.

## After this plan

- Desktop shell S2/S3 builds the Changes pane, the worktree and environment settings, the "Configure local environment" popover and the handoff dialog on these methods (desktop-shell.md), plus the Actions toolbar and "Open terminal".
- Not in Phase B: pinned chats and permanent worktrees (exempt from pruning in Codex; added with pinning), Cloud work, and Git LFS-aware snapshots. Each is additive.

## Review history

v1-v13 (2026-10-17) went through twelve review rounds with KnightCode on GPT-6.1 Sol (23, 17, 13, 12, 12, 8, 9, 7, 10, 8, 9 and 6 findings). Every finding was settled, most by running git to check the claim; the probes the plan still relies on are cited where they are used (literal pathspecs, `GIT_DIFF_OPTS`, `-O/dev/null`, `ls-tree` on directories, `worktree add --no-checkout`, path-limited `reset`, `cat-file -t`, the empty tree in SHA-256 repositories). Rounds 13 to 19 on v14 (blockers and majors only) found 11, 7, 6, 3, 3, 3 and 2 implementation gaps, all fixed. Round 19's: nested repositories found by walking the worktree (one initialized inside a tracked directory is no gitlink), and staged paths captured with `--no-renames`. Round 20 found no blocker or major issue and rated the plan ready. Round 18's: a partly removed checkout recovered from its saved administration directory, review comments bound to the user item their start produced, and the fetch test matched to the algorithm. Round 17's: the nested-repository check before every removal attempt, filter overrides through `GIT_CONFIG_COUNT` so a driver named `x=y` is disabled too, and a preparation lease for a standalone restore. Round 16's: nested repositories found in the snapshot itself, work done after a failed removal snapshotted before the retry, and the cleanup script's paths stored in the manifest. Round 15's: worktrees with initialized submodules never auto-deleted, the ignored-file check on `git/branch/switch`, a preparation lease against pruning, empty patches as no-ops, no handoff of a chat without messages, and the worktree prefix taken from the source checkout. Round 14's: one checkout move per handoff so the ignored-file check sees every write, a detached main checkout's commit kept, restore's `HEAD` put back, an already deleted worktree keeping its snapshot, queued inputs and subscribers carried through the handoff's reload, whitespace-hidden reads pairing sections correctly, and fetching the remote that owns a remote-tracking base. Round 13's: the worktree's own `core.worktree` pinned as the crate does, ignored files in a handoff's way refused, staged state and `skip-worktree` edits kept in snapshots, one ref per snapshot and a `removalFailed` state, sibling commits kept on a handoff back, and the lock, exclusive-queue and closing-transition cycles removed by phasing the handoff and running deletion after the archive transition. Most findings from round 6 to 12 concerned v13's handoff (merging or applying into a dirty checkout: pending records, raw byte fingerprints, abort predicates, a quarantine across restarts) and its rule that worktrees are never deleted automatically. The counts did not converge. Checking the Codex app showed that it avoids both problems: its handoff requires a clean destination and moves the changes to a new branch, and it deletes worktrees freely because it snapshots them first. v14 adopts both, together with the rest of Codex's behaviour, and drops the machinery they made unnecessary.
