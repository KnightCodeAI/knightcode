/**
 * File operations that ask the editor first.
 *
 * The built-in read, edit and write tools take pluggable operations. These
 * route text through the client that owns the session — the editor's
 * buffers, unsaved changes included — and fall back to local disk only when
 * the client says it does not own the path. Images are bytes, which the
 * text-only client surface cannot carry, so they always come from disk.
 *
 * Registered as `customTools`, the resulting definitions replace the
 * built-ins by name. They are built by the same factories, so the tool
 * descriptions and the system prompt do not change.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { constants } from "node:fs";
import { dirname } from "node:path";
import {
	access as fsAccess,
	mkdir as fsMkdir,
	readFile as fsReadFile,
	writeFile as fsWriteFile,
} from "node:fs/promises";
import {
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type EditOperations,
	type ReadOperations,
	type ToolDef,
	type WriteOperations,
} from "../core/tools/index.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";
import type { ClientReply, ClientRequests } from "./client-requests.ts";

export interface ClientFileCapabilities {
	readTextFile: boolean;
	writeTextFile: boolean;
}

/**
 * The tool call currently executing, so a file request can be attributed to
 * it, and the turn's abort signal, so a parked request releases the tool when
 * the turn is aborted by any path.
 */
interface ToolScope {
	toolCallId: string;
	signal: AbortSignal | undefined;
}

const currentToolCall = new AsyncLocalStorage<ToolScope>();

function unexpected(reply: ClientReply): never {
	throw new Error(reply.kind === "error" ? reply.message : `unexpected reply: ${reply.kind}`);
}

export function createClientFileOperations(
	sessionId: string,
	requests: ClientRequests,
	capabilities: ClientFileCapabilities,
): { read: ReadOperations; edit: EditOperations; write: WriteOperations } {
	async function readFile(absolutePath: string): Promise<Buffer> {
		if (!capabilities.readTextFile || (await detectSupportedImageMimeTypeFromFile(absolutePath))) {
			return fsReadFile(absolutePath);
		}
		const scope = currentToolCall.getStore();
		const reply = await requests.ask(
			sessionId,
			{ kind: "fs.read", toolCallId: scope?.toolCallId, path: absolutePath },
			scope?.signal,
		);
		if (reply.kind === "fs.read") return Buffer.from(reply.content, "utf-8");
		if (reply.kind === "error" && reply.code === "not_found") return fsReadFile(absolutePath);
		return unexpected(reply);
	}

	/**
	 * The only path to local disk. It makes the parent directories itself, so
	 * the write tool's `mkdir` step below is a no-op: when the client owns
	 * writes, nothing may land on the engine host before the client has
	 * answered, a directory included.
	 */
	async function writeToDisk(absolutePath: string, content: string): Promise<void> {
		await fsMkdir(dirname(absolutePath), { recursive: true });
		await fsWriteFile(absolutePath, content, "utf-8");
	}

	async function writeFile(absolutePath: string, content: string): Promise<void> {
		if (!capabilities.writeTextFile) return writeToDisk(absolutePath, content);
		const scope = currentToolCall.getStore();
		const reply = await requests.ask(
			sessionId,
			{ kind: "fs.write", toolCallId: scope?.toolCallId, path: absolutePath, content },
			scope?.signal,
		);
		if (reply.kind === "fs.write") return;
		if (reply.kind === "error" && reply.code === "not_found") return writeToDisk(absolutePath, content);
		return unexpected(reply);
	}

	return {
		read: {
			readFile,
			access: (path) => fsAccess(path, constants.R_OK),
			detectImageMimeType: detectSupportedImageMimeTypeFromFile,
		},
		edit: {
			readFile,
			writeFile,
			access: (path) => fsAccess(path, constants.R_OK | constants.W_OK),
		},
		write: {
			writeFile,
			mkdir: async () => {},
		},
	};
}

/** Run a definition's execute inside a scope that names the tool call and carries its signal. */
function scoped(definition: ToolDef): ToolDef {
	return {
		...definition,
		execute: (toolCallId, params, signal, onUpdate, ctx) =>
			currentToolCall.run({ toolCallId, signal }, () => definition.execute(toolCallId, params, signal, onUpdate, ctx)),
	};
}

export function createClientFileTools(
	cwd: string,
	sessionId: string,
	requests: ClientRequests,
	capabilities: ClientFileCapabilities,
	options: { autoResizeImages: boolean },
): ToolDef[] {
	const ops = createClientFileOperations(sessionId, requests, capabilities);
	return [
		scoped(createReadToolDefinition(cwd, { operations: ops.read, autoResizeImages: options.autoResizeImages })),
		scoped(createEditToolDefinition(cwd, { operations: ops.edit })),
		scoped(createWriteToolDefinition(cwd, { operations: ops.write })),
	];
}
