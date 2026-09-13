/**
 * How a tool call looks in the editor: its kind, its title, the files it
 * touches, and its output as content. Pure.
 */

import { isAbsolute, relative, resolve } from "node:path";
import type { ToolCallContent, ToolCallLocation, ToolKind } from "@agentclientprotocol/sdk";
import type { ToolContent } from "../events.ts";

export function toolKind(name: string): ToolKind {
	switch (name) {
		case "read":
			return "read";
		case "edit":
		case "write":
			return "edit";
		case "bash":
		case "powershell":
			return "execute";
		case "grep":
		case "find":
		case "ls":
			return "search";
		default:
			return "other";
	}
}

function stringArg(args: unknown, key: string): string | undefined {
	if (typeof args !== "object" || args === null) return undefined;
	const value = (args as Record<string, unknown>)[key];
	return typeof value === "string" && value.length > 0 ? value : undefined;
}

function absolutePath(path: string, cwd: string): string {
	return isAbsolute(path) ? path : resolve(cwd, path);
}

/** Relative to cwd when inside it, absolute otherwise. */
function displayPath(path: string, cwd: string): string {
	const absolute = absolutePath(path, cwd);
	const rel = relative(cwd, absolute);
	return rel.length > 0 && !rel.startsWith("..") && !isAbsolute(rel) ? rel : absolute;
}

export function toolTitle(name: string, args: unknown, cwd: string): string {
	const path = stringArg(args, "path");
	switch (name) {
		case "read":
			return path ? `Read ${displayPath(path, cwd)}` : "Read";
		case "edit":
			return path ? `Edit ${displayPath(path, cwd)}` : "Edit";
		case "write":
			return path ? `Write ${displayPath(path, cwd)}` : "Write";
		case "bash":
		case "powershell":
			return stringArg(args, "command") ?? name;
		case "grep":
		case "find": {
			const pattern = stringArg(args, "pattern");
			return pattern ? `${name} ${pattern}` : name;
		}
		case "ls":
			return path ? `ls ${displayPath(path, cwd)}` : "ls";
		default:
			return name;
	}
}

export function toolLocations(name: string, args: unknown, cwd: string): ToolCallLocation[] {
	const path = stringArg(args, "path");
	switch (name) {
		case "read":
		case "edit":
		case "write":
		case "grep":
		case "find":
		case "ls":
			return path ? [{ path: absolutePath(path, cwd) }] : [];
		default:
			return [];
	}
}

export function toolResultContent(content: readonly ToolContent[]): ToolCallContent[] {
	return content.map((block) =>
		block.type === "text"
			? { type: "content", content: { type: "text", text: block.text } }
			: { type: "content", content: { type: "image", data: block.data, mimeType: block.mimeType } },
	);
}
