/**
 * Worktree workspaces (§6.1), after the Codex desktop app and its worktree crate (codex-rs/worktree): detached
 * worktrees in `<root>/<bucket>/<repoName>`, a manifest per bucket, creation with no user code and a complete
 * rollback, and the placement that tells where a thread runs.
 */

import { randomBytes } from "node:crypto";
import {
	constants as fsConstants,
	copyFileSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import { StringDecoder } from "node:string_decoder";
import {
	Environment,
	type NotificationParams,
	type PlatformScript,
	type Warning,
	type Workspace,
} from "@knightcode/app-server-protocol";
import { CONFIG_DIR_NAME } from "../config.ts";
import { getShellConfig, type ShellConfig } from "../utils/shell.ts";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { readSettings } from "./config.ts";
import { AppServerError } from "./errors.ts";
import {
	git,
	headTree,
	machineApply,
	machinePatch,
	ProcessKilled,
	ProcessKillUnconfirmed,
	type Repo,
	repoOf,
	requireRepo,
	runGit,
	runProcess,
	snapshotTree,
	submodulePaths,
	withRepoLock,
} from "./git.ts";

const Deleted = Type.Object(
	{
		snapshot: Type.Optional(Type.String()),
		reason: Type.Union([Type.Literal("archive"), Type.Literal("prune"), Type.Literal("user")]),
		at: Type.Number(),
		removalFailed: Type.Optional(Type.Literal(true)),
		adminDir: Type.Optional(Type.String()),
		afterFailure: Type.Optional(
			Type.Object({ head: Type.String(), index: Type.String(), tree: Type.String() }, { additionalProperties: false }),
		),
		later: Type.Optional(Type.Array(Type.String())),
	},
	{ additionalProperties: false },
);
const ManifestSchema = Type.Object(
	{
		version: Type.Literal(2),
		ownerThreadId: Type.String(),
		projectCwd: Type.String(),
		mainRoot: Type.String(),
		sourceCwd: Type.String(),
		cwd: Type.String(),
		commonDir: Type.String(),
		path: Type.String(),
		baseRef: Type.String(),
		environment: Type.Optional(Type.String()),
		setupFailed: Type.Optional(Type.Literal(true)),
		placement: Type.Record(Type.String(), Type.Union([Type.Literal("local"), Type.Literal("worktree")])),
		handoffBranch: Type.Optional(Type.String()),
		lastUsedAt: Type.Number(),
		deleted: Type.Optional(Deleted),
	},
	{ additionalProperties: false },
);
/** A managed worktree's record, `<root>/<bucket>/worktree.json`. Written before the worktree exists. */
export type Manifest = Static<typeof ManifestSchema>;
const checkManifest = Compile(ManifestSchema);

const SettingsSchema = Type.Object(
	{
		root: Type.Optional(Type.String()),
		autoDelete: Type.Optional(Type.Boolean()),
		keep: Type.Optional(Type.Integer({ minimum: 1 })),
		fetchBeforeCreate: Type.Optional(Type.Boolean()),
		branchPrefix: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const checkSettings = Compile(SettingsSchema);

export interface WorktreeSettings {
	/** worktrees.root, else join(agentDir, "worktrees"). */
	root: string;
	autoDelete: boolean;
	keep: number;
	fetchBeforeCreate: boolean;
	branchPrefix: string;
}

/** Test gates only (Global Constraints): each is awaited at the named point. */
export const workspaceHooks = {
	afterWorktreeAdd: async () => {},
	beforeInclude: async (_worktree: string) => {},
	afterForkFrom: async () => {},
	beforeHandoffApply: async () => {},
	afterUserCheck: async () => {},
};

const WIN = process.platform === "win32";
export const samePath = (a: string, b: string) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (parent: string, child: string) => {
	const rel = relative(parent, child);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
};

/**
 * git's branch name rules (git check-ref-format --branch), checked without starting git. A name is never valid
 * because this says so alone: git refuses whatever this misses when the branch is created.
 */
export function validBranchName(name: string): boolean {
	if (name === "" || name === "@" || name.startsWith("-") || name.startsWith("/") || name.endsWith("/")) return false;
	if (name.endsWith(".") || name.includes("..") || name.includes("//") || name.includes("@{")) return false;
	if (/[\x00-\x20\x7f~^:?*[\\]/.test(name)) return false;
	return name.split("/").every((part) => !part.startsWith(".") && !part.endsWith(".lock"));
}

export function worktreeSettings(agentDir: string, warnings: Warning[]): WorktreeSettings {
	const defaults: WorktreeSettings = {
		root: join(agentDir, "worktrees"),
		autoDelete: true,
		keep: 15,
		fetchBeforeCreate: false,
		branchPrefix: "kc/",
	};
	const value = (readSettings(agentDir, undefined, false).settings as { worktrees?: unknown }).worktrees;
	if (value === undefined) return defaults;
	const path = join(agentDir, "settings.json");
	if (!checkSettings.Check(value) || (value.root !== undefined && !isAbsolute(value.root))) {
		warnings.push({ source: "settings", path, message: "worktrees: invalid value; the defaults are used" });
		return defaults;
	}
	const settings = { ...defaults, ...value };
	if (!validBranchName(`${settings.branchPrefix}sample`)) {
		warnings.push({ source: "settings", path, message: `worktrees.branchPrefix: not a valid branch prefix` });
		settings.branchPrefix = defaults.branchPrefix;
	}
	return settings;
}

/** realpath of the deepest existing ancestor, with the missing rest appended: a deleted worktree's cwd is gone. */
function canonical(path: string): string {
	const missing: string[] = [];
	let current = path;
	for (;;) {
		try {
			return join(realpathSync.native(current), ...missing.reverse());
		} catch {
			const parent = dirname(current);
			if (parent === current) return path;
			missing.push(basename(current));
			current = parent;
		}
	}
}

const manifests = new Map<string, { mtimeMs: number; manifest: Manifest | undefined }>();

function readManifest(file: string): Manifest | undefined {
	const info = statSync(file, { throwIfNoEntry: false });
	if (!info) {
		manifests.delete(file);
		return undefined;
	}
	const cached = manifests.get(file);
	if (cached?.mtimeMs === info.mtimeMs) return cached.manifest;
	let manifest: Manifest | undefined;
	try {
		const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
		manifest = checkManifest.Check(parsed) ? parsed : undefined;
	} catch {
		manifest = undefined;
	}
	manifests.set(file, { mtimeMs: info.mtimeMs, manifest });
	return manifest;
}

const BUCKET = /^[0-9a-f]{4}$/;

function rootOf(settings: WorktreeSettings): string | undefined {
	try {
		return realpathSync.native(settings.root);
	} catch {
		return undefined;
	}
}

/** The manifest of the managed worktree containing `cwd`, or undefined (not under the root, malformed, or missing). */
export function manifestFor(settings: WorktreeSettings, cwd: string): Manifest | undefined {
	const root = rootOf(settings);
	if (!root) return undefined;
	const path = canonical(cwd);
	const rel = relative(root, path);
	if (rel.startsWith("..") || isAbsolute(rel)) return undefined;
	const segments = rel.split(sep).filter(Boolean);
	if (segments.length < 2 || !BUCKET.test(segments[0])) return undefined;
	const manifest = readManifest(join(root, segments[0], "worktree.json"));
	return manifest && inside(manifest.path, path) ? manifest : undefined;
}

/** Every managed worktree's manifest under the root. */
export function allManifests(settings: WorktreeSettings): Manifest[] {
	const root = rootOf(settings);
	if (!root) return [];
	let names: string[];
	try {
		names = readdirSync(root);
	} catch {
		return [];
	}
	return names
		.filter((name) => BUCKET.test(name))
		.flatMap((name) => readManifest(join(root, name, "worktree.json")) ?? []);
}

/** The manifest that places `threadId` (a handoff), scanned from <root>/*\/worktree.json and memoized per file mtime. */
export function manifestPlacing(settings: WorktreeSettings, threadId: string): Manifest | undefined {
	return allManifests(settings).find((manifest) => manifest.placement[threadId] !== undefined);
}

export function writeManifest(_settings: WorktreeSettings, manifest: Manifest): void {
	const file = join(dirname(manifest.path), "worktree.json");
	const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(temp, `${JSON.stringify(manifest, null, 2)}\n`);
	renameSync(temp, file);
	manifests.delete(file);
}

/** Records use for pruning (Task 10), at most once a minute per manifest. */
export function touchManifest(settings: WorktreeSettings, cwd: string): void {
	const manifest = manifestFor(settings, cwd);
	if (!manifest || manifest.deleted || Date.now() - manifest.lastUsedAt < 60_000) return;
	try {
		writeManifest(settings, { ...manifest, lastUsedAt: Date.now() });
	} catch {
		/* A read-only root keeps working; pruning sees an older time. */
	}
}

function worktreeWorkspace(manifest: Manifest): Workspace {
	return {
		mode: "worktree",
		path: manifest.path,
		baseRef: manifest.baseRef,
		ownerThreadId: manifest.ownerThreadId,
		...(manifest.environment !== undefined ? { environment: manifest.environment } : {}),
		...(manifest.setupFailed ? { setupFailed: true } : {}),
		...(manifest.deleted ? { deleted: true } : {}),
	};
}

/** The live cwd and workspace of a thread whose session header names `headerCwd`. */
export function placeThread(
	settings: WorktreeSettings,
	threadId: string,
	headerCwd: string,
): { cwd: string; workspace: Workspace; manifest?: Manifest } {
	const own = manifestFor(settings, headerCwd);
	if (own) {
		if (own.placement[threadId] === "local")
			return {
				cwd: join(own.mainRoot, relative(own.path, canonical(headerCwd))),
				workspace: { mode: "local", worktree: own.path },
				manifest: own,
			};
		return { cwd: headerCwd, workspace: worktreeWorkspace(own), manifest: own };
	}
	const placing = manifestPlacing(settings, threadId);
	if (placing?.placement[threadId] === "worktree")
		return {
			cwd: join(placing.path, relative(placing.mainRoot, canonical(headerCwd))),
			workspace: worktreeWorkspace(placing),
			manifest: placing,
		};
	if (placing) return { cwd: headerCwd, workspace: { mode: "local", worktree: placing.path }, manifest: placing };
	return { cwd: headerCwd, workspace: { mode: "local" } };
}

export interface CreateInput {
	settings: WorktreeSettings;
	/** Identity: environments, manifest, session directory. */
	projectCwd: string;
	/** The checkout to start from and, with carryLocalChanges, to copy changes from (a fork's source). */
	sourceCwd: string;
	threadId: string;
	ownerThreadId: string;
	baseRef?: string;
	carryLocalChanges?: boolean;
	environment?: string;
	signal: AbortSignal;
	warnings: Warning[];
}

/** Fetch the remote the base comes from, when it has one; a failure is a warning (fetchBeforeCreate). */
async function fetchBase(repo: Repo, baseRef: string | undefined, signal: AbortSignal, warnings: Warning[]) {
	const full = (await runGit(repo.root, ["rev-parse", "--symbolic-full-name", baseRef ?? "HEAD"], { signal })).stdout
		.toString("utf8")
		.trim();
	let tracking: string | undefined;
	if (full.startsWith("refs/remotes/")) tracking = full.slice("refs/remotes/".length);
	else if (full.startsWith("refs/heads/")) {
		const upstream = await runGit(
			repo.root,
			// `<branch>@{upstream}` takes the short name: "refs/heads/main@{upstream}" is "no such branch" (probed).
			["rev-parse", "--abbrev-ref", "--symbolic-full-name", `${full.slice("refs/heads/".length)}@{upstream}`],
			{ signal },
		);
		if (upstream.code === 0) tracking = upstream.stdout.toString("utf8").trim();
	}
	if (!tracking) return;
	const remotes = (await git(repo.root, ["remote"], { signal })).split("\n").filter(Boolean);
	const remote = remotes.filter((name) => tracking.startsWith(`${name}/`)).sort((a, b) => b.length - a.length)[0];
	if (!remote) return;
	try {
		const result = await runGit(repo.root, ["fetch", "--quiet", "--no-tags", remote], {
			internal: true,
			signal,
			timeoutMs: 120_000,
		});
		if (result.code !== 0) throw new Error(result.stderr.trim());
	} catch (error) {
		if (signal.aborted || error instanceof ProcessKillUnconfirmed) throw error;
		warnings.push({
			source: "server",
			message: `Could not fetch ${remote}; the worktree starts from what is here: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
}

/** `<root>/<bucket>`, made with a non-recursive mkdir so two starts never share one (the crate's allocate_worktree_root). */
function allocateBucket(settings: WorktreeSettings): string {
	mkdirSync(settings.root, { recursive: true });
	const root = realpathSync.native(settings.root);
	for (let i = 0; i < 64; i++) {
		const bucket = join(root, randomBytes(2).toString("hex"));
		try {
			mkdirSync(bucket);
			return bucket;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
		}
	}
	throw new AppServerError("internal", "no free worktree slot");
}

export function createWorktree(input: CreateInput): Promise<{ manifest: Manifest; cwd: string }> {
	return requireRepo(input.sourceCwd).then((sourceRepo) => withRepoLock(sourceRepo, () => create(input, sourceRepo)));
}

async function create(input: CreateInput, sourceRepo: Repo): Promise<{ manifest: Manifest; cwd: string }> {
	const { signal } = input;
	if (input.carryLocalChanges && input.baseRef !== undefined)
		throw new AppServerError("invalidParams", "local changes belong to the current checkout; leave out baseRef");
	const mainRoot = (await requireRepo(input.projectCwd)).root;
	const prefix = sourceRepo.prefix;
	if (input.settings.fetchBeforeCreate) await fetchBase(sourceRepo, input.baseRef, signal, input.warnings);
	const revision = `${input.baseRef ?? "HEAD"}^{commit}`;
	const resolved = await runGit(sourceRepo.root, ["rev-parse", "--verify", "--end-of-options", revision], { signal });
	if (resolved.code !== 0) {
		throw new AppServerError(
			"invalidParams",
			input.baseRef === undefined
				? "commit something first: a worktree starts from a commit"
				: `no commit ${input.baseRef}`,
		);
	}
	const baseSha = resolved.stdout.toString("utf8").trim();
	if (prefix !== "") {
		const kind = await runGit(sourceRepo.root, ["cat-file", "-t", `${baseSha}:${prefix}`], { signal });
		if (kind.stdout.toString("utf8").trim() !== "tree")
			throw new AppServerError("invalidParams", `the base commit has no ${prefix}`);
	}
	let patch: Buffer | undefined;
	if (input.carryLocalChanges) {
		const from = await headTree(sourceRepo);
		const to = await snapshotTree(sourceRepo, true, signal);
		if ((await submodulePaths(sourceRepo, from, to)).length > 0)
			throw new AppServerError(
				"invalidParams",
				"submodule changes are not supported here; commit them in the submodule",
			);
		patch = await machinePatch(sourceRepo, from, to, { binary: true, signal });
	}

	const bucket = allocateBucket(input.settings);
	const path = join(bucket, basename(sourceRepo.root));
	const cwd = join(path, ...prefix.split("/").filter(Boolean));
	const manifest: Manifest = {
		version: 2,
		ownerThreadId: input.ownerThreadId,
		projectCwd: canonical(input.projectCwd),
		mainRoot,
		sourceCwd: canonical(input.sourceCwd),
		cwd,
		commonDir: sourceRepo.commonDir,
		path,
		baseRef: baseSha,
		...(input.environment !== undefined ? { environment: input.environment } : {}),
		placement: {},
		lastUsedAt: Date.now(),
	};
	let registered = false;
	try {
		writeManifest(input.settings, manifest);
		await git(sourceRepo.root, ["worktree", "add", "--detach", "--no-checkout", path, baseSha], {
			internal: true,
			signal,
		});
		registered = true;
		await workspaceHooks.afterWorktreeAdd();
		const config = await git(path, ["rev-parse", "--path-format=absolute", "--git-path", "config.worktree"], {
			signal,
		});
		await git(path, ["config", "--file", config, "core.worktree", path], { internal: true, signal });
		await git(path, ["--work-tree=.", "reset", "-q", "--hard", "--no-recurse-submodules", baseSha], {
			internal: true,
			noFilters: true,
			signal,
		});
		if (patch && patch.length > 0) {
			for (const check of [true, false]) {
				const applied = await machineApply(path, patch, { check, signal });
				if (applied.code !== 0)
					throw new AppServerError("gitConflict", "the local changes could not be carried into the worktree", {
						reason: "patchFailed",
						output: applied.stderr,
					});
			}
		}
		return { manifest, cwd };
	} catch (error) {
		if (error instanceof ProcessKillUnconfirmed)
			throw new ProcessKillUnconfirmed(`${error.message}; the incomplete worktree is left at ${bucket}`);
		// Nothing but git ran in the checkout, so it can go entirely (fresh signal: the original may be aborted).
		if (registered)
			await runGit(sourceRepo.root, ["worktree", "remove", "--force", path], { internal: true }).catch(() => {});
		rmSync(bucket, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
		throw error;
	}
}

/** The error to answer when a created worktree is kept after a later failure: the original code, with data.worktree. */
export function keptWorktree(error: unknown, manifest: Manifest): AppServerError {
	const data = { worktree: manifest.path };
	if (error instanceof AppServerError) {
		const original = typeof error.data === "object" && error.data !== null ? error.data : {};
		return new AppServerError(error.code, error.message, { ...original, ...data });
	}
	return new AppServerError("internal", error instanceof Error ? error.message : String(error), data);
}

const EnvironmentsFile = Type.Object(
	{ version: Type.Literal(1), environments: Type.Array(Environment, { maxItems: 50 }) },
	{ additionalProperties: false },
);
const checkEnvironmentsFile = Compile(EnvironmentsFile);
const environmentsPath = (projectCwd: string) => join(projectCwd, CONFIG_DIR_NAME, "environments.json");

function duplicateName(environments: Environment[]): string | undefined {
	const seen = new Set<string>();
	for (const { name } of environments) {
		if (seen.has(name)) return name;
		seen.add(name);
	}
	return undefined;
}

/** The project's environments (§6.1): a missing file is none, an invalid one is invalidParams naming the problem. */
export function readEnvironments(projectCwd: string): Environment[] {
	const file = environmentsPath(projectCwd);
	if (!existsSync(file)) return [];
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(file, "utf8"));
	} catch (error) {
		throw new AppServerError("invalidParams", `${file}: ${error instanceof Error ? error.message : String(error)}`);
	}
	if (!checkEnvironmentsFile.Check(parsed)) {
		const first = checkEnvironmentsFile.Errors(parsed)[0];
		throw new AppServerError(
			"invalidParams",
			`${file}: ${first ? `${first.instancePath || "/"} ${first.message}` : "not a valid environments file"}`,
		);
	}
	const duplicate = duplicateName(parsed.environments);
	if (duplicate) throw new AppServerError("invalidParams", `${file}: two environments are named "${duplicate}"`);
	return parsed.environments;
}

/** Writes the file with a temp file and rename; it holds no code that runs here, so it needs no trust. */
export function saveEnvironments(projectCwd: string, environments: Environment[]): void {
	const duplicate = duplicateName(environments);
	if (duplicate) throw new AppServerError("invalidParams", `two environments are named "${duplicate}"`);
	const file = environmentsPath(projectCwd);
	mkdirSync(dirname(file), { recursive: true });
	const temp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
	writeFileSync(temp, `${JSON.stringify({ version: 1, environments }, null, 2)}\n`);
	renameSync(temp, file);
}

/** The variant for this platform when present and not blank, else `default` when not blank. */
export function scriptFor(script: PlatformScript | undefined): string | undefined {
	if (!script) return undefined;
	const key = WIN ? "windows" : process.platform === "darwin" ? "macos" : "linux";
	const variant = script[key];
	if (variant?.trim()) return variant;
	return script.default?.trim() ? script.default : undefined;
}

const INCLUDE_MAX_FILES = 10_000;
const INCLUDE_MAX_BYTES = 512 * 1024 * 1024;

/** Paths of `candidates` that `git check-ignore` (run at `cwd` with `extra` args) reports ignored. */
async function ignoredOf(
	cwd: string,
	candidates: string[],
	extra: string[],
	signal: AbortSignal,
): Promise<Set<string>> {
	if (candidates.length === 0) return new Set();
	const result = await runGit(cwd, ["check-ignore", "-z", "--stdin", ...extra], {
		input: `${candidates.join("\0")}\0`,
		// check-ignore refuses the literal pathspec mode; it matches paths against ignore rules and never globs them.
		env: { GIT_LITERAL_PATHSPECS: "0" },
		signal,
	});
	if (result.code !== 0 && result.code !== 1) throw new Error(`git check-ignore: ${result.stderr.trim()}`);
	return new Set(result.stdout.toString("utf8").split("\0").filter(Boolean));
}

/**
 * Copies the ignored files `.worktreeinclude` lists (§6.1). Only files ignored in both checkouts, so a copy never
 * becomes an untracked file a commit or handoff would publish; nothing is ever created through a link.
 */
export async function copyWorktreeInclude(
	sourceRoot: string,
	worktreeRoot: string,
	warnings: Warning[],
	signal: AbortSignal,
): Promise<void> {
	await workspaceHooks.beforeInclude(worktreeRoot);
	const include = join(sourceRoot, ".worktreeinclude");
	if (!lstatSync(include, { throwIfNoEntry: false })?.isFile()) return;
	const listed = await runGit(sourceRoot, ["ls-files", "-z", "--others", "--ignored", `--exclude-from=${include}`], {
		signal,
	});
	const candidates = listed.stdout.toString("utf8").split("\0").filter(Boolean);
	const inSource = await ignoredOf(sourceRoot, candidates, [], signal);
	const inWorktree = await ignoredOf(worktreeRoot, candidates, ["--no-index"], signal);
	let files = 0;
	let bytes = 0;
	for (const path of candidates) {
		if (!inSource.has(path)) continue;
		if (!inWorktree.has(path)) {
			warnings.push({
				source: "server",
				message: `${path} was not copied into the worktree: the worktree does not ignore it, so it could be committed`,
			});
			continue;
		}
		const source = lstatSync(join(sourceRoot, path), { throwIfNoEntry: false });
		if (!source?.isFile()) continue;
		if (files >= INCLUDE_MAX_FILES || bytes + source.size > INCLUDE_MAX_BYTES) {
			warnings.push({
				source: "server",
				message: `.worktreeinclude: stopped at ${files} files; more than ${INCLUDE_MAX_FILES} files or 512 MiB`,
			});
			return;
		}
		const parts = path.split("/");
		let dir = worktreeRoot;
		let blocked = false;
		for (const part of parts.slice(0, -1)) {
			dir = join(dir, part);
			const info = lstatSync(dir, { throwIfNoEntry: false });
			if (!info) mkdirSync(dir);
			else if (info.isSymbolicLink() || !info.isDirectory()) {
				blocked = true;
				break;
			}
		}
		if (blocked) {
			warnings.push({ source: "server", message: `${path} was not copied: a directory on its way is a link` });
			continue;
		}
		try {
			copyFileSync(join(sourceRoot, path), join(worktreeRoot, ...parts), fsConstants.COPYFILE_EXCL);
			files++;
			bytes += source.size;
		} catch (error) {
			warnings.push({
				source: "server",
				message: `${path} was not copied: ${error instanceof Error ? error.message : String(error)}`,
			});
		}
	}
}

const PROGRESS_MS = 100;
const PROGRESS_BYTES = 64 * 1024;
const TAIL_BYTES = 4096;

type Progress = (params: NotificationParams<"thread/workspace/progress">) => void;

export interface ScriptRun {
	phase: "setup" | "cleanup";
	script: string;
	threadId: string;
	projectCwd: string;
	sourceCwd: string;
	worktreeCwd: string;
	timeoutMs: number;
	signal: AbortSignal;
	progress?: Progress;
	shellConfig?: ShellConfig;
}

/** The outcome of an environment script; output lives only in the progress stream and a 4 KiB tail. */
export async function runEnvironmentScript(
	run: ScriptRun,
): Promise<{ ok: true } | { ok: false; tail: string; reason: "exit" | "timeout" | "unconfirmed" | "noShell" }> {
	let tail = "";
	let pending = "";
	let dropped = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const flush = () => {
		timer = undefined;
		if (!pending && !dropped) return;
		const output = dropped ? `[… ${dropped} bytes dropped]\n${pending}` : pending;
		pending = "";
		dropped = 0;
		if (run.progress) run.progress({ threadId: run.threadId, phase: run.phase, output });
		else process.stderr.write(output);
	};
	const decoder = new StringDecoder("utf8");
	const take = (chunk: Buffer) => {
		const text = decoder.write(chunk);
		tail = (tail + text).slice(-TAIL_BYTES);
		pending += text;
		if (pending.length > PROGRESS_BYTES) {
			dropped += pending.length - PROGRESS_BYTES;
			pending = pending.slice(-PROGRESS_BYTES);
		}
		timer ??= setTimeout(flush, PROGRESS_MS);
	};
	let config: ShellConfig;
	try {
		config = run.shellConfig ?? getShellConfig();
	} catch (error) {
		return { ok: false, tail: error instanceof Error ? error.message : String(error), reason: "noShell" };
	}
	const stdin = config.commandTransport === "stdin";
	try {
		const result = await runProcess(config.shell, stdin ? config.args : [...config.args, run.script], {
			cwd: run.projectCwd,
			input: stdin ? run.script : undefined,
			env: { KNIGHTCODE_SOURCE_TREE_PATH: run.sourceCwd, KNIGHTCODE_WORKTREE_PATH: run.worktreeCwd },
			timeoutMs: run.timeoutMs,
			signal: run.signal,
			collectStdout: false,
			stderrTailBytes: TAIL_BYTES,
			onStdout: take,
			onStderr: take,
		});
		return result.code === 0 ? { ok: true } : { ok: false, tail, reason: "exit" };
	} catch (error) {
		if (run.signal.aborted) throw error;
		if (error instanceof ProcessKilled) return { ok: false, tail, reason: "timeout" };
		if (error instanceof ProcessKillUnconfirmed) return { ok: false, tail, reason: "unconfirmed" };
		if (error instanceof AppServerError && error.code === "toolMissing")
			return { ok: false, tail: error.message, reason: "noShell" };
		throw error;
	} finally {
		clearTimeout(timer);
		tail += decoder.end();
		flush();
	}
}

export interface PrepareInput {
	settings: WorktreeSettings;
	manifest: Manifest;
	threadId: string;
	trusted: boolean;
	warnings: Warning[];
	signal: AbortSignal;
	progress?: Progress;
	shellConfig?: ShellConfig;
}

/** After creation: `.worktreeinclude`, then the environment's setup script (§6.1). Returns the manifest as written. */
export async function prepareWorktree(input: PrepareInput): Promise<Manifest> {
	const { manifest, warnings, signal } = input;
	const source = await repoOf(manifest.sourceCwd);
	if (source) await copyWorktreeInclude(source.root, manifest.path, warnings, signal);
	if (manifest.environment === undefined) return manifest;
	if (!input.trusted) {
		warnings.push({
			source: "trust",
			message: `This project is not trusted, so the setup of environment "${manifest.environment}" did not run.`,
		});
		return manifest;
	}
	const environment = readEnvironments(manifest.projectCwd).find((e) => e.name === manifest.environment);
	const script = scriptFor(environment?.setup);
	if (!script) return manifest;
	let outcome: Awaited<ReturnType<typeof runEnvironmentScript>>;
	try {
		outcome = await runEnvironmentScript({
			phase: "setup",
			script,
			threadId: input.threadId,
			projectCwd: manifest.projectCwd,
			sourceCwd: manifest.sourceCwd,
			worktreeCwd: manifest.cwd,
			timeoutMs: 600_000,
			signal,
			progress: input.progress,
			shellConfig: input.shellConfig,
		});
	} catch (error) {
		if (signal.aborted) throw new AppServerError("shuttingDown", "the app server shut down during the worktree setup");
		throw error;
	}
	if (outcome.ok) return manifest;
	const updated: Manifest = { ...manifest, setupFailed: true };
	writeManifest(input.settings, updated);
	const why =
		outcome.reason === "timeout"
			? "timed out"
			: outcome.reason === "unconfirmed"
				? "timed out; a setup process may still be running"
				: outcome.reason === "noShell"
					? "found no shell to run in"
					: "failed";
	warnings.push({
		source: "server",
		message: `The setup of environment "${manifest.environment}" ${why}:\n${outcome.tail}`,
	});
	return updated;
}

/** Before a deletion (Task 10): the environment's cleanup script; a failure is a warning, the deletion goes on. */
export async function runCleanup(input: Omit<PrepareInput, "settings">): Promise<void> {
	const { manifest, warnings } = input;
	if (manifest.environment === undefined || !input.trusted) return;
	let environment: Environment | undefined;
	try {
		environment = readEnvironments(manifest.projectCwd).find((e) => e.name === manifest.environment);
	} catch (error) {
		warnings.push({ source: "server", message: error instanceof Error ? error.message : String(error) });
		return;
	}
	const script = scriptFor(environment?.cleanup);
	if (!script) return;
	const outcome = await runEnvironmentScript({
		phase: "cleanup",
		script,
		threadId: input.threadId,
		projectCwd: manifest.projectCwd,
		sourceCwd: manifest.sourceCwd,
		worktreeCwd: manifest.cwd,
		timeoutMs: 300_000,
		signal: input.signal,
		progress: input.progress,
		shellConfig: input.shellConfig,
	});
	if (!outcome.ok)
		warnings.push({
			source: "server",
			message: `The cleanup of environment "${manifest.environment}" failed:\n${outcome.tail}`,
		});
}
