import { describe, expect, it } from "vitest";
import { ApiError, createApiClient, matchRoute, queryToRequest, ROUTES } from "../src/index.ts";

type Call = { method: string; url: string; body: unknown };

function recordingFetch(reply: () => Response) {
	const calls: Call[] = [];
	const fetch = async (input: string | URL | Request, init?: RequestInit) => {
		calls.push({ method: init?.method ?? "GET", url: String(input), body: init?.body });
		return reply();
	};
	return { calls, fetch: fetch as typeof globalThis.fetch };
}

describe("createApiClient", () => {
	it("fills path params from the request and sends the rest as a JSON body", async () => {
		const { calls, fetch } = recordingFetch(() => Response.json({ ok: true }));
		await createApiClient(fetch, "https://bots.test").updateBot({ botId: "b1", name: "Rex" });
		expect(calls).toEqual([
			{ method: "PATCH", url: "https://bots.test/api/bots/b1", body: JSON.stringify({ name: "Rex" }) },
		]);
	});

	it("sends GET fields as the query string", async () => {
		const { calls, fetch } = recordingFetch(() => Response.json({ runs: [] }));
		await createApiClient(fetch, "https://bots.test").listRuns({ botId: "b 1", status: "failed" });
		expect(calls[0]).toMatchObject({
			method: "GET",
			url: "https://bots.test/api/runs?botId=b+1&status=failed",
			body: undefined,
		});
	});

	it("throws ApiError carrying the status and the server's error code", async () => {
		const { fetch } = recordingFetch(() => Response.json({ error: "not_found" }, { status: 404 }));
		const failure = createApiClient(fetch, "https://bots.test").getBot({ botId: "x" });
		await expect(failure).rejects.toBeInstanceOf(ApiError);
		await expect(failure).rejects.toMatchObject({ status: 404, code: "not_found" });
	});
});

describe("matchRoute", () => {
	it("finds the route and its path params", () => {
		expect(matchRoute("PATCH", "/api/bots/b1")).toMatchObject({
			route: { name: "updateBot" },
			params: { botId: "b1" },
		});
		expect(matchRoute("GET", "/api/nope")).toBeUndefined();
	});

	it("reads a query back into the request shape without turning string ids into numbers", () => {
		const { route } = matchRoute("GET", "/api/runs")!;
		expect(queryToRequest(route, new URLSearchParams("botId=12&from=5&status=failed"))).toEqual({
			botId: "12",
			from: 5,
			status: "failed",
		});
	});

	it("covers the routes the screens name", () => {
		const names = new Set(ROUTES.map((route) => route.name));
		for (const name of [
			"createBot",
			"listBots",
			"updateBot",
			"listModels",
			"answerApproval",
			"listInbox",
			"listCatalog",
			"connectApp",
			"createRoutine",
			"putVault",
			"listVault",
			"topUp",
			"issueTicket",
		])
			expect(names, name).toContain(name);
	});
});
