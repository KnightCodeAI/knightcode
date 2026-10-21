import type { AgentTool } from "@knightcode/agent";
import { mkdir as fsMkdir, readFile as fsReadFile, stat as fsStat, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { type Static, Type } from "typebox";
import { stripBom } from "../../utils/text.ts";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { generateDiffString, generateUnifiedPatch, normalizeToLF } from "./edit-diff.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";
import { writeRenderers } from "./renderers/write.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const writeSchema = Type.Object({
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export const writeToolSystemPromptContribution = {
	snippet: "Create or overwrite files",
	guidelines: ["Use write only for new files or complete rewrites."],
} as const;

export type WriteToolInput = Static<typeof writeSchema>;

export interface WriteToolDetails {
	/** Display diff against the previous contents, when the write replaced a file that differed. */
	diff?: string;
	/** Standard unified patch of the change; a new file patches against empty contents. */
	patch?: string;
	/** The write created the file. */
	created?: boolean;
}

/** Larger files are written without a display diff. */
const MAX_DIFF_CHARS = 1024 * 1024;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
	/**
	 * Read the current contents for the diff: null when the file does not exist, undefined when there is
	 * nothing to diff against (unreadable or too large). Without it, writes show no diff.
	 */
	readFile?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
	// Display only: any read failure drops the diff, and the write itself reports an unwritable target.
	readFile: (path) =>
		fsStat(path)
			.then((stats) => (stats.size > MAX_DIFF_CHARS ? undefined : fsReadFile(path, "utf-8")))
			.catch((error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? null : undefined)),
};

/** The display diff (overwrites only) and the unified patch against the previous contents. */
function writeDetails(path: string, previous: string | null | undefined, content: string): WriteToolDetails {
	const created = previous === null ? { created: true } : {};
	if (previous === undefined || (previous ?? "").length + content.length > MAX_DIFF_CHARS) return created;
	const before = normalizeToLF(stripBom(previous ?? ""));
	const after = normalizeToLF(stripBom(content));
	if (before === after) return created;
	const patch = generateUnifiedPatch(path, before, after);
	return previous === null ? { patch, created: true } : { diff: generateDiffString(before, after).diff, patch };
}

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, WriteToolDetails | undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
		promptSnippet: writeToolSystemPromptContribution.snippet,
		promptGuidelines: [...writeToolSystemPromptContribution.guidelines],
		parameters: writeSchema,
		constrainedSampling: { type: "json_schema", strict: "prefer" },
		async execute(
			_toolCallId,
			{ path, content }: { path: string; content: string },
			signal?: AbortSignal,
			_onUpdate?,
			ctx?: ExtensionContext,
		) {
			const absolutePath = resolveToCwd(path, ctx?.cwd || cwd);
			const dir = dirname(absolutePath);
			return withFileMutationQueue(absolutePath, async () => {
				// Do not reject from an abort event listener here: that would release the
				// mutation queue while an in-flight filesystem operation may still finish.
				// Checking signal.aborted after each await observes the same aborts while
				// keeping the queue locked until the current operation has settled.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();
				const previous = await ops.readFile?.(absolutePath);
				throwIfAborted();
				// Create parent directories if needed.
				await ops.mkdir(dir);
				throwIfAborted();

				// Write the file contents.
				await ops.writeFile(absolutePath, content);
				throwIfAborted();

				const details = writeDetails(path, previous, content);
				return {
					content: [{ type: "text", text: `Successfully wrote to ${path}` }],
					details: Object.keys(details).length > 0 ? details : undefined,
				};
			});
		},
		...writeRenderers,
	};
}

export function createWriteTool(cwd: string, options?: WriteToolOptions): AgentTool<typeof writeSchema> {
	return wrapToolDefinition(createWriteToolDefinition(cwd, options));
}
