import { request } from "node:http";
import { afterEach, describe, expect, test } from "vitest";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";

/** Raw request helper: `fetch` refuses to set a Host header, which the guard checks. */
function rawRequest(
	port: number,
	path: string,
	headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const req = request({ host: "127.0.0.1", port, path, method: "GET", headers }, (res) => {
			let body = "";
			res.setEncoding("utf-8");
			res.on("data", (chunk: string) => (body += chunk));
			res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
		});
		req.on("error", reject);
		req.end();
	});
}

describe("engine server", () => {
	let server: EngineServer | undefined;

	afterEach(async () => {
		await server?.close();
		server = undefined;
	});

	async function start(token = "test-token"): Promise<string> {
		server = await startEngineServer({
			token,
			routes: [
				{
					method: "GET",
					path: "/v1/ping",
					handle: (_req, res) => {
						res.writeHead(200, { "content-type": "application/json" });
						res.end(JSON.stringify({ ok: true }));
					},
				},
			],
		});
		return `http://127.0.0.1:${server.port}`;
	}

	test("binds an ephemeral loopback port", async () => {
		const base = await start();
		expect(server?.port).toBeGreaterThan(0);
		expect(base).toContain("127.0.0.1");
	});

	test("serves /health without a token", async () => {
		const base = await start();
		const res = await fetch(`${base}/health`);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ status: "ok" });
	});

	test("rejects a missing token", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`);
		expect(res.status).toBe(401);
	});

	test("rejects a wrong token of the same length", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer wrong-token" } });
		expect(res.status).toBe(401);
	});

	test("rejects a token of a different length", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer short" } });
		expect(res.status).toBe(401);
	});

	test("rejects a non-bearer authorization scheme", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Basic test-token" } });
		expect(res.status).toBe(401);
	});

	test("accepts the correct token", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/ping`, { headers: { authorization: "Bearer test-token" } });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});

	test("rejects a non-loopback Host header", async () => {
		await start();
		const res = await rawRequest(server!.port, "/v1/ping", {
			authorization: "Bearer test-token",
			host: "evil.example.com",
		});
		expect(res.status).toBe(403);
	});

	test("accepts a loopback Host header with a port", async () => {
		await start();
		const res = await rawRequest(server!.port, "/v1/ping", {
			authorization: "Bearer test-token",
			host: `localhost:${server!.port}`,
		});
		expect(res.status).toBe(200);
	});

	test("returns 404 for an unknown authenticated path", async () => {
		const base = await start();
		const res = await fetch(`${base}/v1/nothing`, { headers: { authorization: "Bearer test-token" } });
		expect(res.status).toBe(404);
	});

	test("a throwing route becomes a 500 rather than a hung socket", async () => {
		server = await startEngineServer({
			token: "t",
			routes: [
				{
					method: "GET",
					path: "/v1/boom",
					handle: () => {
						throw new Error("kaboom");
					},
				},
			],
		});
		const res = await fetch(`http://127.0.0.1:${server.port}/v1/boom`, { headers: { authorization: "Bearer t" } });
		expect(res.status).toBe(500);
	});
});
