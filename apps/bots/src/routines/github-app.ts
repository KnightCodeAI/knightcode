// GitHub through the "KnightCode Bots" GitHub App (spec section 12): signed webhook events for pull requests, reviews,
// comments, issues and CI, filtered by repository, event, branch and (optionally) the GitHub users who acted. The
// bot's comments are posted as the app, with an installation token, never as the user.
import type { Trigger } from "@knightcode/bots-protocol";
import { asOutsideText, hmacHex, sameSignature, type TriggerAdapter, type TriggerEvent } from "./triggers.ts";

type Payload = Record<string, any>;

/** Our event names for GitHub's (event header + action). */
export function eventName(event: string, payload: Payload): string | undefined {
	const action = payload.action as string | undefined;
	switch (event) {
		case "pull_request":
			if (action === "opened") return "pr.opened";
			if (action === "synchronize") return "pr.pushed";
			if (action === "closed") return payload.pull_request?.merged ? "pr.merged" : "pr.closed";
			if (action === "review_requested") return "pr.review_requested";
			return undefined;
		case "pull_request_review":
			if (action !== "submitted") return undefined;
			if (payload.review?.state === "approved") return "pr.approved";
			if (payload.review?.state === "changes_requested") return "pr.changes_requested";
			return "pr.reviewed";
		case "pull_request_review_comment":
			return action === "created" ? "pr.inline_comment" : undefined;
		case "pull_request_review_thread":
			return action === "resolved" ? "pr.thread_resolved" : action === "unresolved" ? "pr.thread_unresolved" : undefined;
		case "issue_comment":
			if (action !== "created") return undefined;
			return payload.issue?.pull_request ? "pr.comment" : "issue.comment";
		case "issues":
			return action === "opened" ? "issue.opened" : action === "assigned" ? "issue.assigned" : undefined;
		case "check_suite":
			if (action !== "completed") return undefined;
			return payload.check_suite?.conclusion === "success" ? "ci.passed" : "ci.failed";
		default:
			return undefined;
	}
}

function describe(name: string, payload: Payload): { title: string; text: string; branch?: string; user?: string } {
	const repo = payload.repository?.full_name as string;
	const pr = payload.pull_request ?? (payload.issue?.pull_request ? payload.issue : undefined);
	const issue = payload.issue;
	const user = (payload.sender?.login as string | undefined) ?? undefined;
	const branch = (payload.pull_request?.base?.ref ?? payload.check_suite?.head_branch) as string | undefined;
	const number = pr?.number ?? issue?.number;
	const title = `${name} ${number ? `#${number} ` : ""}in ${repo}`;
	const body = [
		`event: ${name}`,
		`repository: ${repo}`,
		number ? `number: ${number}` : undefined,
		pr?.title ?? issue?.title ? `title: ${pr?.title ?? issue?.title}` : undefined,
		user ? `by: ${user}` : undefined,
		branch ? `branch: ${branch}` : undefined,
		payload.comment?.body ? `comment:\n${payload.comment.body}` : undefined,
		payload.review?.body ? `review:\n${payload.review.body}` : undefined,
		pr?.body ? `description:\n${pr.body}` : issue?.body ? `description:\n${issue.body}` : undefined,
		pr?.html_url ?? issue?.html_url ? `url: ${pr?.html_url ?? issue?.html_url}` : undefined,
	].filter(Boolean);
	return { title, text: body.join("\n"), branch, user };
}

export const githubAdapter: TriggerAdapter<"github"> = {
	kind: "github",
	async verify(request, env) {
		const secret = env.GITHUB_APP_WEBHOOK_SECRET;
		const signature = request.headers.get("x-hub-signature-256") ?? "";
		if (!secret || !signature.startsWith("sha256=")) return undefined;
		const raw = await request.text();
		if (!sameSignature(signature.slice(7), await hmacHex(secret, raw))) return undefined;
		const payload = JSON.parse(raw) as Payload;
		const name = eventName(request.headers.get("x-github-event") ?? "", payload);
		const repo = payload.repository?.full_name as string | undefined;
		if (!name || !repo) return [];
		const { title, text, branch, user } = describe(name, payload);
		const event: TriggerEvent = {
			kind: "github",
			routeKey: repo.toLowerCase(),
			title,
			text: asOutsideText("GitHub", text),
			fields: { event: name, branch, user, installation: String(payload.installation?.id ?? "") },
		};
		return event;
	},
	matches(trigger: Extract<Trigger, { kind: "github" }>, event) {
		if (trigger.repo.toLowerCase() !== event.routeKey) return false;
		if (!trigger.events.includes(event.fields.event ?? "")) return false;
		if (trigger.branch && event.fields.branch !== trigger.branch) return false;
		if (trigger.users?.length && !trigger.users.some((user) => user.toLowerCase() === event.fields.user?.toLowerCase())) return false;
		return true;
	},
};

// ─── Posting as the app ─────────────────────────────────────────────────────

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** The app's JWT (RS256 over a PKCS#8 private key), good for nine minutes. */
export async function appJwt(appId: string, privateKeyPem: string, now = Date.now()): Promise<string> {
	const der = Uint8Array.from(atob(privateKeyPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
	const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
	const seconds = Math.floor(now / 1000);
	const encode = (value: object) => b64url(new TextEncoder().encode(JSON.stringify(value)));
	const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iat: seconds - 60, exp: seconds + 540, iss: appId })}`;
	const signature = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned)));
	return `${unsigned}.${b64url(signature)}`;
}

/** Posts `body` on an issue or pull request as the app, through the installation that delivered the event. */
export async function commentAsApp(input: {
	appId: string;
	privateKey: string;
	installationId: string;
	repo: string;
	number: number;
	body: string;
	apiUrl?: string;
}): Promise<{ id: number }> {
	const api = input.apiUrl ?? "https://api.github.com";
	const headers = { accept: "application/vnd.github+json", "user-agent": "knightcode-bots" };
	const tokenResponse = await fetch(`${api}/app/installations/${input.installationId}/access_tokens`, {
		method: "POST",
		headers: { ...headers, authorization: `Bearer ${await appJwt(input.appId, input.privateKey)}` },
	});
	if (!tokenResponse.ok) throw new Error(`GitHub refused the installation token (${tokenResponse.status})`);
	const { token } = (await tokenResponse.json()) as { token: string };
	const response = await fetch(`${api}/repos/${input.repo}/issues/${input.number}/comments`, {
		method: "POST",
		headers: { ...headers, authorization: `Bearer ${token}`, "content-type": "application/json" },
		body: JSON.stringify({ body: input.body }),
	});
	if (!response.ok) throw new Error(`GitHub refused the comment (${response.status})`);
	return (await response.json()) as { id: number };
}
