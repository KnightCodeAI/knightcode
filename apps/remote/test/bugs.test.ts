import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { issueSessionCookie, upsertAccount } from "../src/accounts.ts";
import { uploadBugReport } from "../src/bugs.ts";

const UA = { "user-agent": "knightcode/1.2.3" };

beforeEach(async () => {
	await env.DB.exec("DELETE FROM bug_reports");
	await env.DB.exec("DELETE FROM accounts");
	const listed = await env.BUGS.list();
	for (const object of listed.objects) await env.BUGS.delete(object.key);
});

const REPORT = {
	id: "01J000000000000000000CLIENT",
	version: "1.2.3",
	description: "the editor froze after a tool call",
	environment: { platform: "win32", arch: "x64", runtime: "bun/1.3.3" },
	crashes: [{ message: "boom" }, { message: "boom again" }],
};

function bundle(overrides: Record<string, string | undefined> = {}): FormData {
	const form = new FormData();
	const files: Record<string, string | undefined> = {
		"report.json": JSON.stringify(REPORT),
		"diagnostics.json": JSON.stringify({ errors: [] }),
		...overrides,
	};
	for (const [name, body] of Object.entries(files)) {
		if (body === undefined) continue;
		form.append(name, new File([body], name));
	}
	return form;
}

/**
 * A distinct client address per call. The rate limiter is enforced by the local runtime
 * too, and it keys on this header, so sharing one address would make every test after the
 * third in a file answer 429 for reasons that have nothing to do with what it asserts.
 */
let address = 0;
function post(body: FormData, headers: Record<string, string> = UA, ip?: string): Promise<Response> {
	return SELF.fetch("https://remote.knightcode.dev/v1/bug-reports", {
		method: "POST",
		headers: { ...headers, "cf-connecting-ip": ip ?? `203.0.113.${++address % 250}` },
		body,
	});
}

/**
 * `email` is what the allowlist matches, and it is null for an account that signed in before
 * the address was stored — which must not be an admin.
 */
async function signedIn(login: string, email: string | null = null): Promise<string> {
	const account = await upsertAccount(env.DB, "github", `id-${login}`, login, null, email);
	return await issueSessionCookie(env.SIGNING_SECRET, account.id);
}

describe("upload", () => {
	it("stores every supplied file and one row describing it", async () => {
		const response = await post(bundle({ "session.jsonl": '{"a":1}\n', "summary.md": "# what happened\n" }));
		expect(response.status).toBe(200);
		const body = (await response.json()) as { ok: boolean; bug_report: { id: string } };
		expect(body.ok).toBe(true);

		const row = await env.DB.prepare("SELECT * FROM bug_reports WHERE id = ?").bind(body.bug_report.id).first();
		expect(row).toMatchObject({
			client_id: REPORT.id,
			version: "1.2.3",
			platform: "win32",
			arch: "x64",
			runtime: "bun/1.3.3",
			description: REPORT.description,
			has_session: 1,
			has_summary: 1,
			crash_count: 2,
		});

		const prefix = (row as { prefix: string }).prefix;
		for (const file of ["report.json", "diagnostics.json", "session.jsonl", "summary.md"]) {
			expect(await env.BUGS.head(`${prefix}/${file}`), file).not.toBeNull();
		}
	});

	it("records the optional files as absent when they were not sent", async () => {
		const response = await post(bundle());
		const { bug_report } = (await response.json()) as { bug_report: { id: string } };
		const row = await env.DB.prepare("SELECT * FROM bug_reports WHERE id = ?").bind(bug_report.id).first();
		expect(row).toMatchObject({ has_session: 0, has_summary: 0, crash_count: 2 });
	});

	// Losing a report because one metadata field was unexpected is worse than a sparse row.
	it("stores a report whose metadata has nothing recognisable in it", async () => {
		const response = await post(bundle({ "report.json": JSON.stringify({ unrelated: true }) }));
		expect(response.status).toBe(200);
		const { bug_report } = (await response.json()) as { bug_report: { id: string } };
		const row = await env.DB.prepare("SELECT * FROM bug_reports WHERE id = ?").bind(bug_report.id).first();
		expect(row).toMatchObject({ client_id: null, version: null, platform: null, description: null, crash_count: 0 });
	});
});

describe("refusals", () => {
	async function expectRefusal(response: Response, status: number, error: string): Promise<void> {
		expect(response.status).toBe(status);
		expect(await response.json()).toMatchObject({ ok: false, error });
		// Nothing a refusal touched may reach storage.
		const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM bug_reports").first<{ n: number }>();
		expect(rows?.n).toBe(0);
		expect((await env.BUGS.list()).objects).toHaveLength(0);
	}

	it("refuses a request that does not come from KnightCode", async () => {
		await expectRefusal(await post(bundle(), { "user-agent": "curl/8.0" }), 400, "bad_client");
	});

	it("refuses a body that is not multipart", async () => {
		const response = await SELF.fetch("https://remote.knightcode.dev/v1/bug-reports", {
			method: "POST",
			headers: { ...UA, "content-type": "application/json" },
			body: "{}",
		});
		await expectRefusal(response, 400, "bad_request");
	});

	it("refuses a file name outside the four the bundle contains", async () => {
		await expectRefusal(await post(bundle({ "evil.sh": "rm -rf /" })), 400, "unexpected_file");
	});

	it("refuses a bundle with no report.json", async () => {
		await expectRefusal(await post(bundle({ "report.json": undefined })), 400, "missing_file");
	});

	it("refuses a bundle with no diagnostics.json", async () => {
		await expectRefusal(await post(bundle({ "diagnostics.json": undefined })), 400, "missing_file");
	});

	it("refuses a report.json that is not a JSON object", async () => {
		await expectRefusal(await post(bundle({ "report.json": "[1,2,3]" })), 400, "bad_report");
	});

	it("refuses a transcript over 8 MB even when the total is under the body cap", async () => {
		const big = "x".repeat(8 * 1024 * 1024 + 1);
		await expectRefusal(await post(bundle({ "session.jsonl": big })), 413, "too_large");
	});

	it("refuses a bundle whose files together exceed 10 MB", async () => {
		const response = await post(
			bundle({ "session.jsonl": "x".repeat(7 * 1024 * 1024), "summary.md": "y".repeat(4 * 1024 * 1024) }),
		);
		await expectRefusal(response, 413, "too_large");
	});

	// Four uploads from one address, with the binding configured for three a minute. The
	// fourth must be refused before the body is read, so the run leaves three reports and
	// not four.
	it("refuses a fourth upload from the same address within the window", async () => {
		const ip = "198.51.100.7";
		for (let attempt = 0; attempt < 3; attempt++) {
			expect((await post(bundle(), UA, ip)).status).toBe(200);
		}
		const refused = await post(bundle(), UA, ip);
		expect(refused.status).toBe(429);
		expect(await refused.json()).toMatchObject({ ok: false, error: "rate_limited" });
		const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM bug_reports").first<{ n: number }>();
		expect(rows?.n).toBe(3);
	});

	// Content-Length is attacker-controlled. Understating it must not buy a caller the right
	// to have an arbitrarily large body parsed and buffered before the size is noticed.
	it("refuses an oversized body that understates its Content-Length", async () => {
		const huge = "x".repeat(11 * 1024 * 1024);
		const body = new FormData();
		body.append("report.json", new File([JSON.stringify(REPORT)], "report.json"));
		body.append("diagnostics.json", new File(["{}"], "diagnostics.json"));
		body.append("summary.md", new File([huge], "summary.md"));
		const response = await SELF.fetch("https://remote.knightcode.dev/v1/bug-reports", {
			method: "POST",
			headers: { ...UA, "cf-connecting-ip": "198.51.100.20", "content-length": "10" },
			body,
		});
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ ok: false, error: "too_large" });
		expect((await env.BUGS.list()).objects).toHaveLength(0);
	});

	// A different address is a different bucket, so one noisy reporter cannot lock out
	// everyone else.
	it("does not let one address exhaust another's allowance", async () => {
		const noisy = "198.51.100.8";
		for (let attempt = 0; attempt < 4; attempt++) await post(bundle(), UA, noisy);
		expect((await post(bundle(), UA, "198.51.100.9")).status).toBe(200);
	});
});

describe("reading reports", () => {
	async function uploaded(): Promise<string> {
		const response = await post(bundle({ "summary.md": "# what happened\n" }));
		const { bug_report } = (await response.json()) as { bug_report: { id: string } };
		return bug_report.id;
	}

	function get(path: string, cookie?: string): Promise<Response> {
		return SELF.fetch(`https://remote.knightcode.dev${path}`, {
			headers: cookie ? { cookie } : {},
			redirect: "manual",
		});
	}

	it("hides the list and the page from an anonymous visitor", async () => {
		expect((await get("/api/bugs")).status).toBe(404);
		expect((await get("/bugs")).status).toBe(404);
	});

	// 404, not 403: a maintainer-only surface should not confirm it exists.
	it("hides them from a signed-in account that is not an admin", async () => {
		const cookie = await signedIn("someone-else", "someone-else@example.com");
		expect((await get("/api/bugs", cookie)).status).toBe(404);
		expect((await get("/bugs", cookie)).status).toBe(404);
	});

	// The address is only stored when GitHub says it is the account's verified primary one,
	// so a row without one has never proved ownership of any address. It must not match the
	// allowlist, even if the allowlist happens to contain that person's address.
	it("refuses an account that has no stored email", async () => {
		const cookie = await signedIn("no-email", null);
		expect((await get("/api/bugs", cookie)).status).toBe(404);
		expect((await get("/bugs", cookie)).status).toBe(404);
	});

	// The secret is hand-edited, so spacing and casing are part of its contract.
	it("matches an allowlisted address regardless of case", async () => {
		const cookie = await signedIn("second", "another-maintainer@example.com");
		expect((await get("/api/bugs", cookie)).status).toBe(200);
	});

	it("lists reports for an allowlisted login", async () => {
		const id = await uploaded();
		const cookie = await signedIn("maintainer", "maintainer@example.com");
		const response = await get("/api/bugs", cookie);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { reports: Array<{ id: string; description: string }> };
		expect(body.reports).toHaveLength(1);
		expect(body.reports[0]).toMatchObject({ id, description: REPORT.description });
	});

	it("serves a stored file to an admin and refuses everyone else", async () => {
		const id = await uploaded();
		const cookie = await signedIn("maintainer", "maintainer@example.com");
		const response = await get(`/api/bugs/${id}/summary.md`, cookie);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe("# what happened\n");
		expect((await get(`/api/bugs/${id}/summary.md`)).status).toBe(404);
	});

	it("refuses a file the bundle never contains", async () => {
		const id = await uploaded();
		const cookie = await signedIn("maintainer", "maintainer@example.com");
		expect((await get(`/api/bugs/${id}/wrangler.jsonc`, cookie)).status).toBe(404);
	});

	// The lifecycle rule removes objects at 90 days and leaves the row, so the list keeps
	// showing that the report existed while its files answer 404.
	it("404s a file whose object has expired, with the row still listed", async () => {
		const id = await uploaded();
		const cookie = await signedIn("maintainer", "maintainer@example.com");
		for (const object of (await env.BUGS.list()).objects) await env.BUGS.delete(object.key);
		expect((await get(`/api/bugs/${id}/report.json`, cookie)).status).toBe(404);
		const body = (await (await get("/api/bugs", cookie)).json()) as { reports: unknown[] };
		expect(body.reports).toHaveLength(1);
	});
});

const JSON_LINE = '{"a":1}\n';
const SUMMARY = "# x\n";

describe("partial write cleanup", () => {
	// An orphaned object is unreachable, because every read goes through the row - but it
	// would still hold a transcript in the bucket for 90 days with nothing recording it.
	it("removes uploaded files when the row cannot be written", async () => {
		const broken = {
			...env,
			DB: {
				prepare() {
					throw new Error("D1 unavailable");
				},
			},
		};
		const request = new Request("https://remote.knightcode.dev/v1/bug-reports", {
			method: "POST",
			headers: { ...UA, "cf-connecting-ip": "198.51.100.30" },
			body: bundle({ "session.jsonl": JSON_LINE, "summary.md": SUMMARY }),
		});
		await expect(uploadBugReport(broken as never, request)).rejects.toThrow("D1 unavailable");
		expect((await env.BUGS.list()).objects).toHaveLength(0);
	});
});
