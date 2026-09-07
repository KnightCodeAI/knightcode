import { MAX_FRAME_BYTES, TRUNCATION_MARKER } from "./protocol.ts";

/** Entries are cloned before mutation so the live SessionManager copy is never touched. */
const MAX_ENTRY_BYTES = Math.floor(MAX_FRAME_BYTES / 2);

function placeholderFor(block: Record<string, unknown>): Record<string, unknown> {
	const mimeType = typeof block.mimeType === "string" ? block.mimeType : "image";
	const bytes = typeof block.data === "string" ? block.data.length : 0;
	return { type: "text", text: `[image: ${mimeType}, ${bytes} bytes, not mirrored]` };
}

function stripImages(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(stripImages);
	if (typeof value !== "object" || value === null) return value;
	const record = value as Record<string, unknown>;
	if (record.type === "image") return placeholderFor(record);
	const result: Record<string, unknown> = {};
	for (const [key, nested] of Object.entries(record)) result[key] = stripImages(nested);
	return result;
}

function truncate(entry: unknown): unknown {
	const encoded = JSON.stringify(entry) ?? "";
	if (new TextEncoder().encode(encoded).byteLength <= MAX_ENTRY_BYTES) return entry;
	const record = entry as Record<string, unknown>;
	return {
		type: record.type,
		id: record.id,
		parentId: record.parentId,
		timestamp: record.timestamp,
		message: { role: "user", content: [{ type: "text", text: TRUNCATION_MARKER }] },
	};
}

/** Strip image payloads and cap entry size before an entry leaves the machine. */
export function sanitiseEntries(entries: readonly unknown[]): unknown[] {
	return entries.map((entry) => truncate(stripImages(entry)));
}
