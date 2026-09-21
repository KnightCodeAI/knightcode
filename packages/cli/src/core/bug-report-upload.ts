import type { BugReportBundle } from "./bug-report.ts";
import { bugReportFiles } from "./bug-report.ts";
import { VERSION } from "../config.ts";

/** Where `/bug` uploads land. Overridable so a fork or a local Worker can take them instead. */
export const ENV_BUG_ENDPOINT = "KNIGHTCODE_BUG_ENDPOINT";
const DEFAULT_BUG_ENDPOINT = "https://remote.knightcode.dev";

export function getBugEndpoint(): string {
	return process.env[ENV_BUG_ENDPOINT] || DEFAULT_BUG_ENDPOINT;
}

interface UploadBugReportOptions {
	signal?: AbortSignal;
	endpoint?: string;
}

/**
 * Upload a report as multipart form data, one field per file. Always anonymous: there is no
 * KnightCode account for the CLI, and a report is not worth binding to a provider login.
 */
export async function uploadBugReport(
	bundle: BugReportBundle,
	options: UploadBugReportOptions = {},
): Promise<{ id: string }> {
	const body = new FormData();
	for (const file of bugReportFiles(bundle)) {
		body.append(file.name, new Blob([file.data], { type: file.contentType }), file.name);
	}
	const response = await fetch(new URL("/v1/bug-reports", options.endpoint ?? getBugEndpoint()), {
		method: "POST",
		// The endpoint refuses anything that does not identify itself as KnightCode. That is
		// a filter against crawlers, not a security boundary.
		headers: { "user-agent": `knightcode/${VERSION}` },
		body,
		signal: options.signal,
	});
	const json = (await response.json().catch(() => null)) as {
		ok?: boolean;
		bug_report?: { id?: string };
		error?: string;
		description?: string;
	} | null;
	if (response.ok && json?.ok === true && typeof json.bug_report?.id === "string") {
		return { id: json.bug_report.id };
	}
	const detail = json && !json.ok ? json.description || json.error : undefined;
	throw new Error(`Bug report upload failed: ${detail || response.statusText || response.status}`);
}
