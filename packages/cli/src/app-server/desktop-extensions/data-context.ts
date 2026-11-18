/** Resolve explicit persistence identities without opening agent sessions or reading renderer selection. */
import { createHash } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import { readSessionHeaderForDiscovery } from "../../core/session-manager.ts";
import type { experimental_BackendDataSelector } from "../../desktop-backend.ts";
import type { AppServerContext } from "../context.ts";
import { SessionFileIndex } from "../session-files.ts";
import { placeThread, trustedProject, trustKey, worktreeSettings } from "../workspaces.ts";

export interface DesktopDataContext {
	/** Most specific first; the last key always denotes app/user defaults. */
	keys: string[];
	validate(): void;
}

export const DesktopDataSelector = Type.Union([
	Type.Object({ scope: Type.Literal("app") }, { additionalProperties: false }),
	Type.Object({ scope: Type.Literal("project"), cwd: Type.String() }, { additionalProperties: false }),
	Type.Object(
		{ scope: Type.Literal("thread"), cwd: Type.String(), threadId: Type.String({ minLength: 1 }) },
		{ additionalProperties: false },
	),
]);
const checkSelector = Compile(DesktopDataSelector);

/** Validate a reusable wire selector before turning it into a server-owned context. */
export async function resolveDesktopDataContext(
	ctx: AppServerContext | undefined,
	selector: experimental_BackendDataSelector,
	signal: AbortSignal,
): Promise<DesktopDataContext> {
	// Selectors may come straight from an extension's RPC parameters, including Type.Unknown schemas.
	if (!checkSelector.Check(selector)) throw new Error("Invalid desktop data context selector.");
	signal.throwIfAborted();
	if (selector.scope === "app") return { keys: ["app"], validate: () => signal.throwIfAborted() };
	if (!ctx) throw new Error("Project/thread data contexts require an app-server host.");
	const cwd = selector.cwd;
	if (!isAbsolute(cwd)) throw new Error("Data context cwd must be an absolute directory.");
	const project = projectIdentity(ctx, cwd);
	const keys = [`project-${digest(project)}`, "app"];
	let validateThread = () => {};
	if (selector.scope === "thread") {
		const id = selector.threadId;
		const file = await new SessionFileIndex(ctx).find(id);
		signal.throwIfAborted();
		if (!file) throw new Error(`Unknown saved thread data context: ${id}`);
		validateThread = () => {
			const header = readSessionHeaderForDiscovery(file);
			if (header?.id !== id) throw new Error("Thread data context is no longer available.");
			const placement = placeThread(worktreeSettings(ctx.agentDir, []), id, header.cwd);
			if (projectIdentity(ctx, placement.manifest?.projectCwd ?? placement.cwd) !== project)
				throw new Error("Thread data context does not belong to the requested project.");
		};
		keys.unshift(`thread-${digest(id)}`);
	}
	const validate = () => {
		signal.throwIfAborted();
		if (projectIdentity(ctx, cwd) !== project) throw new Error("Project data context identity changed.");
		validateThread();
	};
	validate();
	return { keys, validate };
}

function projectIdentity(ctx: AppServerContext, cwd: string): string {
	const project = trustKey(ctx.agentDir, cwd);
	if (!statSync(project, { throwIfNoEntry: false })?.isDirectory())
		throw new Error("Data context cwd is not a directory.");
	trustedProject(ctx.agentDir, project);
	const canonical = realpathSync.native(project);
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}

function digest(identity: string): string {
	return createHash("sha256").update(identity).digest("hex");
}
