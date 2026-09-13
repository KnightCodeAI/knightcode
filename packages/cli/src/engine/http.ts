import type { IncomingMessage } from "node:http";

export class BodyError extends Error {
	readonly status: 400 | 413;

	constructor(status: 400 | 413, message: string) {
		super(message);
		this.status = status;
	}
}

/** A prompt carrying screenshots is megabytes of base64; the login reader's 64 KB would refuse it. */
const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;

export async function readJsonBody(
	req: IncomingMessage,
	maxBytes = DEFAULT_MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
	const chunks: Buffer[] = [];
	let size = 0;
	for await (const chunk of req) {
		const buffer = chunk as Buffer;
		size += buffer.length;
		if (size > maxBytes) throw new BodyError(413, "body too large");
		chunks.push(buffer);
	}
	if (chunks.length === 0) return {};
	let parsed: unknown;
	try {
		parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
	} catch {
		throw new BodyError(400, "body is not JSON");
	}
	return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}
