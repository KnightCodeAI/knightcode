/**
 * Session routes.
 *
 * A session is created, prompted, cancelled, reconfigured and closed here.
 * The turn itself is not a response: `prompt` answers 202 once preflight has
 * passed and the outcome arrives on /events as `session.turn_end`. Questions
 * the engine has for the client arrive there too, as `session.request`, and
 * are answered through the `requests` route.
 */

import type { ServerResponse } from "node:http";
import type { ThinkingLevel } from "@knightcode/agent";
import type { ImageContent } from "@knightcode/ai";
import { THINKING_LEVEL_OPTIONS } from "../core/defaults.ts";
import type { ClientFileCapabilities } from "./client-fs.ts";
import type { ClientReply, PermissionOutcome } from "./client-requests.ts";
import { ModelLookupError, resolveModel, sendLookupError } from "./completions.ts";
import type { EngineContext } from "./context.ts";
import { BodyError, readJsonBody } from "./http.ts";
import { type EngineRoute, sendJson } from "./server.ts";
import { SessionError, type SessionRegistry } from "./sessions.ts";

const PREFIX = "/v1/sessions/";
const PERMISSION_OUTCOMES: ReadonlySet<string> = new Set([
	"allow_once",
	"allow_always",
	"reject_once",
	"reject_always",
	"cancelled",
]);

function statusOf(error: SessionError): number {
	switch (error.code) {
		case "not_found":
			return 404;
		case "busy":
			return 409;
		case "auth_required":
			return 401;
		default:
			return 400;
	}
}

function sendError(res: ServerResponse, error: unknown): void {
	if (error instanceof SessionError) {
		sendJson(res, statusOf(error), { error: error.code, message: error.message });
	} else if (error instanceof ModelLookupError) {
		sendLookupError(res, error);
	} else if (error instanceof BodyError) {
		sendJson(res, error.status, { error: "bad_request", message: error.message });
	} else {
		sendJson(res, 500, { error: "internal", message: error instanceof Error ? error.message : String(error) });
	}
}

function sendNoContent(res: ServerResponse): void {
	res.writeHead(204);
	res.end();
}

/** The path after the prefix, decoded; empty when a segment is not valid percent-encoding. */
function segments(url: URL): string[] {
	try {
		return url.pathname.slice(PREFIX.length).split("/").map(decodeURIComponent);
	} catch {
		return [];
	}
}

function parseThinkingLevel(value: unknown): ThinkingLevel | undefined {
	if (value === undefined) return undefined;
	if (typeof value === "string" && (THINKING_LEVEL_OPTIONS as readonly string[]).includes(value)) {
		return value as ThinkingLevel;
	}
	throw new SessionError("bad_request", `unknown thinking level: ${String(value)}`);
}

function parseImages(value: unknown): ImageContent[] | undefined {
	if (value === undefined) return undefined;
	if (!Array.isArray(value)) throw new SessionError("bad_request", "images must be an array");
	return value.map((entry: unknown) => {
		const image = typeof entry === "object" && entry !== null ? (entry as Record<string, unknown>) : {};
		if (typeof image.data !== "string" || typeof image.mimeType !== "string") {
			throw new SessionError("bad_request", "an image needs data and mimeType");
		}
		return { type: "image", data: image.data, mimeType: image.mimeType };
	});
}

function parseCapabilities(value: unknown): Partial<ClientFileCapabilities> | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const record = value as Record<string, unknown>;
	return { readTextFile: record.readTextFile === true, writeTextFile: record.writeTextFile === true };
}

function parseReply(body: Record<string, unknown>): ClientReply {
	switch (body.kind) {
		case "permission":
			if (typeof body.outcome === "string" && PERMISSION_OUTCOMES.has(body.outcome)) {
				return { kind: "permission", outcome: body.outcome as PermissionOutcome };
			}
			break;
		case "fs.read":
			if (typeof body.content === "string") return { kind: "fs.read", content: body.content };
			break;
		case "fs.write":
			return { kind: "fs.write" };
		case "error":
			if (body.code === "not_found" || body.code === "failed") {
				return { kind: "error", code: body.code, message: typeof body.message === "string" ? body.message : "" };
			}
			break;
		default:
			break;
	}
	throw new SessionError("bad_request", "malformed reply");
}

export function sessionRoutes(ctx: EngineContext, sessions: SessionRegistry): readonly EngineRoute[] {
	return [
		{
			method: "POST",
			path: "/v1/sessions",
			handle: async (req, res) => {
				try {
					const body = await readJsonBody(req);
					if (typeof body.cwd !== "string" || body.cwd.length === 0) {
						throw new SessionError("bad_request", "cwd is required");
					}
					const model = typeof body.model === "string" ? resolveModel(ctx, body.model) : undefined;
					const summary = await sessions.create({
						cwd: body.cwd,
						model,
						capabilities: parseCapabilities(body.capabilities),
					});
					sendJson(res, 201, summary);
				} catch (error) {
					sendError(res, error);
				}
			},
		},
		{
			method: "GET",
			path: "/v1/sessions",
			prefix: true,
			handle: (_req, res, url) => {
				const [id, ...rest] = segments(url);
				const summary = id && rest.length === 0 ? sessions.summary(id) : undefined;
				if (summary) sendJson(res, 200, summary);
				else sendJson(res, 404, { error: "not_found" });
			},
		},
		{
			method: "PATCH",
			path: "/v1/sessions",
			prefix: true,
			handle: async (req, res, url) => {
				try {
					const [id, ...rest] = segments(url);
					if (!id || rest.length > 0) throw new SessionError("not_found", "unknown session");
					const body = await readJsonBody(req);
					const model = typeof body.model === "string" ? resolveModel(ctx, body.model) : undefined;
					const thinkingLevel = parseThinkingLevel(body.thinkingLevel);
					sendJson(res, 200, await sessions.update(id, { model, thinkingLevel }));
				} catch (error) {
					sendError(res, error);
				}
			},
		},
		{
			method: "DELETE",
			path: "/v1/sessions",
			prefix: true,
			handle: async (_req, res, url) => {
				const [id, ...rest] = segments(url);
				if (id && rest.length === 0 && (await sessions.close(id))) sendNoContent(res);
				else sendJson(res, 404, { error: "not_found" });
			},
		},
		{
			method: "POST",
			path: "/v1/sessions",
			prefix: true,
			handle: async (req, res, url) => {
				const [id, action, requestId, ...rest] = segments(url);
				try {
					if (!id || rest.length > 0) throw new SessionError("not_found", "unknown session");
					if (action === "prompt" && requestId === undefined) {
						const body = await readJsonBody(req);
						const text = typeof body.text === "string" ? body.text : "";
						const images = parseImages(body.images);
						if (text.length === 0 && !images?.length) throw new SessionError("bad_request", "prompt is empty");
						await sessions.prompt(id, { text, images });
						sendJson(res, 202, { accepted: true });
						return;
					}
					if (action === "cancel" && requestId === undefined) {
						if (!(await sessions.cancel(id))) throw new SessionError("not_found", `unknown session: ${id}`);
						sendNoContent(res);
						return;
					}
					if (action === "requests" && requestId) {
						const reply = parseReply(await readJsonBody(req));
						if (sessions.reply(id, requestId, reply)) sendNoContent(res);
						else sendJson(res, 404, { error: "unknown_request" });
						return;
					}
					sendJson(res, 404, { error: "not_found" });
				} catch (error) {
					sendError(res, error);
				}
			},
		},
	];
}
