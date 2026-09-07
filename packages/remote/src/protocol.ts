export const PROTOCOL_VERSION = 1;
export const MAX_FRAME_BYTES = 1_048_576;
export const MAX_PROMPT_BYTES = 131_072;
export const MAX_ROOM_BYTES = 8_388_608;
export const MAX_VIEWER_BUFFER_BYTES = 4_194_304;
export const MAX_VIEWERS = 8;
export const TRUNCATION_MARKER = "[knightcode-remote: content truncated]";

export type ToolPhase = "start" | "update" | "end";

export type HostFrame =
	| {
			v: 1;
			type: "snapshot";
			cwd: string;
			leafId: string | null;
			entries: unknown[];
			sessionName?: string;
			model?: string;
	  }
	| { v: 1; type: "entries"; entries: unknown[] }
	| { v: 1; type: "stream"; messageId: string; content: string }
	| { v: 1; type: "tool"; toolCallId: string; toolName: string; phase: ToolPhase; payload: unknown }
	| { v: 1; type: "status"; idle: boolean; streaming: boolean; model?: string; contextTokens?: number }
	| { v: 1; type: "bye"; reason: string };

export type ViewerFrame =
	{ v: 1; type: "hello"; since?: number } | { v: 1; type: "prompt"; text: string } | { v: 1; type: "abort" };

export type RelayFrame =
	{ v: 1; type: "resnapshot" } | { v: 1; type: "viewer"; count: number } | { v: 1; type: "error"; message: string };

export type StampedFrame = HostFrame & { seq: number };

export function encodeFrame(frame: HostFrame | ViewerFrame | RelayFrame | StampedFrame): string {
	return JSON.stringify(frame);
}

export function frameByteLength(encoded: string): number {
	return new TextEncoder().encode(encoded).byteLength;
}

function parseObject(raw: string, maxBytes: number): Record<string, unknown> | undefined {
	if (frameByteLength(raw) > maxBytes) return undefined;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return undefined;
	}
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
	const record = parsed as Record<string, unknown>;
	if (record.v !== PROTOCOL_VERSION) return undefined;
	return record;
}

/** Validate one frame arriving from a browser. This is a trust boundary; every field is checked. */
export function decodeViewerFrame(raw: string): ViewerFrame | undefined {
	const record = parseObject(raw, MAX_PROMPT_BYTES + 1024);
	if (!record) return undefined;
	if (record.type === "abort") return { v: 1, type: "abort" };
	if (record.type === "hello") {
		if (record.since === undefined) return { v: 1, type: "hello" };
		if (typeof record.since !== "number" || !Number.isSafeInteger(record.since) || record.since < 0) return undefined;
		return { v: 1, type: "hello", since: record.since };
	}
	if (record.type === "prompt") {
		if (typeof record.text !== "string" || record.text.length === 0) return undefined;
		if (frameByteLength(record.text) > MAX_PROMPT_BYTES) return undefined;
		return { v: 1, type: "prompt", text: record.text };
	}
	return undefined;
}

const HOST_FRAME_TYPES = new Set(["snapshot", "entries", "stream", "tool", "status", "bye"]);

/** Shallow validation of a host frame. The relay never inspects payload bodies. */
export function decodeHostFrame(raw: string): HostFrame | undefined {
	const record = parseObject(raw, MAX_FRAME_BYTES);
	if (!record || typeof record.type !== "string" || !HOST_FRAME_TYPES.has(record.type)) return undefined;
	return record as unknown as HostFrame;
}
