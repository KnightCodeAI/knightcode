import type { Env } from "./accounts.ts";
import { randomId } from "./crypto.ts";

/**
 * `/bug` in the CLI builds the bundle and posts it here as multipart form data, one field
 * per file named after the file. Nothing else may be uploaded: an unknown field name is a
 * refusal rather than something to store, so the bucket can only ever hold these four shapes.
 */
const FILES = {
	"report.json": "application/json",
	"diagnostics.json": "application/json",
	"session.jsonl": "application/x-ndjson",
	"summary.md": "text/markdown",
} as const;
type FileName = keyof typeof FILES;

const REQUIRED: FileName[] = ["report.json", "diagnostics.json"];
const TOTAL_LIMIT = 10 * 1024 * 1024;
const SESSION_LIMIT = 8 * 1024 * 1024;

/**
 * Not a security check, and must never be treated as one: a header costs an attacker
 * nothing. It keeps scanners and stray crawlers from filling the bucket with noise.
 */
const CLIENT_UA = /^knightcode\/\S+/;

type Refusal = { status: number; error: string; description: string };

function refuse({ status, error, description }: Refusal): Response {
	return Response.json({ ok: false, error, description }, { status });
}

function isFileName(name: string): name is FileName {
	return Object.hasOwn(FILES, name);
}

/** Only the fields the list renders; everything else stays in the stored report.json. */
interface ReportMetadata {
	id?: unknown;
	version?: unknown;
	description?: unknown;
	environment?: { platform?: unknown; arch?: unknown; runtime?: unknown };
	crashes?: unknown;
}

function text(value: unknown): string | null {
	return typeof value === "string" && value.length > 0 ? value.slice(0, 2000) : null;
}

/**
 * A report whose metadata is odd is still a report. Everything here degrades to null rather
 * than refusing the upload: losing a bug report because one field was unexpected is worse
 * than a sparse row, and the untouched report.json is in the bucket either way.
 */
function columns(metadata: ReportMetadata) {
	const environment = typeof metadata.environment === "object" && metadata.environment ? metadata.environment : {};
	return {
		clientId: text(metadata.id),
		version: text(metadata.version),
		platform: text(environment.platform),
		arch: text(environment.arch),
		runtime: text(environment.runtime),
		description: text(metadata.description),
		crashCount: Array.isArray(metadata.crashes) ? metadata.crashes.length : 0,
	};
}

export async function uploadBugReport(env: Env, request: Request): Promise<Response> {
	if (!CLIENT_UA.test(request.headers.get("user-agent") ?? "")) {
		return refuse({ status: 400, error: "bad_client", description: "This endpoint accepts reports from KnightCode." });
	}
	if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) {
		return refuse({ status: 400, error: "bad_request", description: "Send the report as multipart/form-data." });
	}

	// Checked before the body is read, so a refused request never costs a bucket write.
	const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
	const { success } = await env.BUG_RATE_LIMIT.limit({ key: ip });
	if (!success) {
		return refuse({ status: 429, error: "rate_limited", description: "Too many reports from here. Try again shortly." });
	}

	// Content-Length is a claim, not a measurement, so the real total is summed below as
	// well. Refusing on the claim first avoids reading 200 MB to discover it is 200 MB.
	const claimed = Number(request.headers.get("content-length") ?? "0");
	if (Number.isFinite(claimed) && claimed > TOTAL_LIMIT) {
		return refuse({ status: 413, error: "too_large", description: "The report is larger than 10 MB." });
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return refuse({ status: 400, error: "bad_request", description: "The multipart body could not be read." });
	}

	const parts = new Map<FileName, ArrayBuffer>();
	let total = 0;
	for (const [name, value] of form.entries()) {
		if (!isFileName(name)) {
			return refuse({ status: 400, error: "unexpected_file", description: `Unexpected file "${name}".` });
		}
		// A field may arrive as a plain string rather than a File; a Blob normalises both to
		// the same bytes without caring which the client chose.
		const body = await (value instanceof File ? value : new Blob([String(value)])).arrayBuffer();
		if (name === "session.jsonl" && body.byteLength > SESSION_LIMIT) {
			return refuse({ status: 413, error: "too_large", description: "The transcript is larger than 8 MB." });
		}
		total += body.byteLength;
		if (total > TOTAL_LIMIT) {
			return refuse({ status: 413, error: "too_large", description: "The report is larger than 10 MB." });
		}
		parts.set(name, body);
	}

	for (const required of REQUIRED) {
		if (!parts.has(required)) {
			return refuse({ status: 400, error: "missing_file", description: `The report is missing ${required}.` });
		}
	}

	let metadata: ReportMetadata;
	try {
		const parsed: unknown = JSON.parse(new TextDecoder().decode(parts.get("report.json")));
		if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("not an object");
		metadata = parsed as ReportMetadata;
	} catch {
		return refuse({ status: 400, error: "bad_report", description: "report.json is not a JSON object." });
	}

	const id = randomId(16);
	const now = new Date();
	const prefix = `bug-reports/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}`;
	const fields = columns(metadata);

	for (const [name, body] of parts) {
		await env.BUGS.put(`${prefix}/${name}`, body, { httpMetadata: { contentType: FILES[name] } });
	}

	// The row is written last: an object with no row is invisible and expires on its own,
	// whereas a row with no objects is a broken entry in the list.
	await env.DB.prepare(
		`INSERT INTO bug_reports
		   (id, created_at, prefix, client_id, version, platform, arch, runtime, description,
		    has_session, has_summary, crash_count, size_bytes)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
	)
		.bind(
			id,
			now.getTime(),
			prefix,
			fields.clientId,
			fields.version,
			fields.platform,
			fields.arch,
			fields.runtime,
			fields.description,
			parts.has("session.jsonl") ? 1 : 0,
			parts.has("summary.md") ? 1 : 0,
			fields.crashCount,
			total,
		)
		.run();

	return Response.json({ ok: true, bug_report: { id } });
}

/**
 * Reports are read by whoever maintains KnightCode, not by the account that filed them —
 * filing needs no account at all. The allowlist is a secret rather than a table so that
 * granting access is a deploy-time act, not something any signed-in visitor can reach.
 */
export function isAdmin(env: Env, login: string | undefined): boolean {
	if (!login) return false;
	return (env.ADMIN_LOGINS ?? "")
		.split(",")
		.map((entry) => entry.trim().toLowerCase())
		.filter(Boolean)
		.includes(login.toLowerCase());
}

export async function adminLogin(env: Env, accountId: string | undefined): Promise<string | undefined> {
	if (!accountId) return undefined;
	const row = await env.DB.prepare("SELECT login FROM accounts WHERE id = ?").bind(accountId).first<{ login: string }>();
	return isAdmin(env, row?.login) ? row?.login : undefined;
}

export async function listBugReports(env: Env): Promise<Response> {
	const rows = await env.DB.prepare(
		`SELECT id, created_at, client_id, version, platform, arch, runtime, description,
		        has_session, has_summary, crash_count, size_bytes
		   FROM bug_reports ORDER BY created_at DESC LIMIT 200`,
	).all();
	return Response.json({ reports: rows.results ?? [] });
}

export async function getBugReportFile(env: Env, id: string, file: string): Promise<Response> {
	if (!isFileName(file)) return new Response("Not found", { status: 404 });
	const row = await env.DB.prepare("SELECT prefix FROM bug_reports WHERE id = ?").bind(id).first<{ prefix: string }>();
	if (!row) return new Response("Not found", { status: 404 });
	// Expired: the lifecycle rule removed the objects but the row is kept, so the list can
	// still show that the report existed.
	const object = await env.BUGS.get(`${row.prefix}/${file}`);
	if (!object) return new Response("Not found", { status: 404 });
	const headers = new Headers({ "content-type": FILES[file] });
	headers.set("content-disposition", `attachment; filename="${id}-${file}"`);
	return new Response(object.body, { headers });
}
