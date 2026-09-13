import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@knightcode/ai";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createEngineContext } from "../../src/engine/context.ts";
import type { EngineEvent } from "../../src/engine/events.ts";
import { type EngineServer, startEngineServer } from "../../src/engine/server.ts";
import { sessionRoutes } from "../../src/engine/session-routes.ts";
import { createSessionRegistry, type SessionRegistry, type SessionSummary } from "../../src/engine/sessions.ts";

const auth = { authorization: "Bearer t", "content-type": "application/json" };

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("session routes", () => {
	let counter = 0;
	let server: EngineServer | undefined;
	let registry: SessionRegistry | undefined;
	const dirs: string[] = [];

	afterEach(async () => {
		await registry?.closeAll();
		await server?.close();
		registry = undefined;
		server = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(options: { tokensPerSecond?: number } = {}) {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-session-routes-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-session-routes-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-routes-${counter++}`, tokensPerSecond: options.tokensPerSecond });
		ctx.models.registerNativeProvider(faux.provider);
		const seen: EngineEvent[] = [];
		ctx.events.subscribe((event) => seen.push(event));
		registry = createSessionRegistry(ctx, { agentDir, sessionDir: null, defaultModel: faux.getModel() });
		server = await startEngineServer({ token: "t", routes: sessionRoutes(ctx, registry) });
		const base = `http://127.0.0.1:${server.port}`;
		const post = (path: string, body?: unknown) =>
			fetch(`${base}${path}`, {
				method: "POST",
				headers: auth,
				body: body === undefined ? undefined : JSON.stringify(body),
			});
		const create = async (): Promise<SessionSummary> => {
			const res = await post("/v1/sessions", { cwd, capabilities: { readTextFile: true, writeTextFile: true } });
			expect(res.status).toBe(201);
			return (await res.json()) as SessionSummary;
		};
		return { base, cwd, faux, seen, post, create };
	}

	test("creates, reads and deletes a session", async () => {
		const { base, create } = await start();
		const summary = await create();
		expect(summary.model?.ref).toContain("/");
		const read = await fetch(`${base}/v1/sessions/${summary.id}`, { headers: auth });
		expect(read.status).toBe(200);
		expect(await read.json()).toEqual(summary);
		const gone = await fetch(`${base}/v1/sessions/${summary.id}`, { method: "DELETE", headers: auth });
		expect(gone.status).toBe(204);
		expect((await fetch(`${base}/v1/sessions/${summary.id}`, { headers: auth })).status).toBe(404);
		expect((await fetch(`${base}/v1/sessions/${summary.id}`, { method: "DELETE", headers: auth })).status).toBe(404);
	});

	test("rejects a create without cwd", async () => {
		const { post } = await start();
		expect((await post("/v1/sessions", {})).status).toBe(400);
	});

	test("rejects a body that is not JSON", async () => {
		const { base } = await start();
		const res = await fetch(`${base}/v1/sessions`, { method: "POST", headers: auth, body: "{not json" });
		expect(res.status).toBe(400);
	});

	test("a prompt answers 202 and the turn ends on the bus", async () => {
		const { faux, seen, post, create } = await start();
		const { id } = await create();
		faux.setResponses([fauxAssistantMessage([fauxText("hi back")])]);
		const res = await post(`/v1/sessions/${id}/prompt`, { text: "hi" });
		expect(res.status).toBe(202);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
		expect(seen.at(-1)).toMatchObject({ type: "session.turn_end", sessionId: id, stopReason: "end_turn" });
	});

	test("a prompt during a turn is 409 and cancel is 204", async () => {
		const { faux, seen, post, create } = await start({ tokensPerSecond: 20 });
		const { id } = await create();
		faux.setResponses([fauxAssistantMessage([fauxText("c".repeat(400))])]);
		expect((await post(`/v1/sessions/${id}/prompt`, { text: "slow" })).status).toBe(202);
		expect((await post(`/v1/sessions/${id}/prompt`, { text: "again" })).status).toBe(409);
		expect((await post(`/v1/sessions/${id}/cancel`)).status).toBe(204);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
		expect(seen.at(-1)).toMatchObject({ type: "session.turn_end", stopReason: "cancelled" });
		expect((await post("/v1/sessions/nope/cancel")).status).toBe(404);
	});

	test("answers a client request and refuses an unknown one", async () => {
		const { faux, seen, post, create } = await start();
		const { id } = await create();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "x" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		await post(`/v1/sessions/${id}/prompt`, { text: "write" });
		await until(() => seen.some((event) => event.type === "session.request"));
		const request = seen.find((event) => event.type === "session.request");
		if (request?.type !== "session.request") throw new Error("no request");
		expect((await post(`/v1/sessions/${id}/requests/nope`, { kind: "permission", outcome: "allow_once" })).status).toBe(
			404,
		);
		expect((await post(`/v1/sessions/${id}/requests/${request.requestId}`, { kind: "nonsense" })).status).toBe(400);
		expect(
			(await post(`/v1/sessions/${id}/requests/${request.requestId}`, { kind: "permission", outcome: "reject_once" }))
				.status,
		).toBe(204);
		await until(() => seen.some((event) => event.type === "session.turn_end"));
	});

	test("patches model and thinking level, and refuses nonsense", async () => {
		const { base, faux, create } = await start();
		const { id, thinkingLevels } = await create();
		const patch = (body: unknown) =>
			fetch(`${base}/v1/sessions/${id}`, { method: "PATCH", headers: auth, body: JSON.stringify(body) });
		const level = thinkingLevels.find((candidate) => candidate !== "medium") ?? "off";
		const ok = await patch({ thinkingLevel: level, model: `${faux.provider.id}/${faux.getModel().id}` });
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as SessionSummary).thinkingLevel).toBe(level);
		expect((await patch({ thinkingLevel: "galactic" })).status).toBe(400);
		expect((await patch({ model: "no-such-model" })).status).toBe(404);
	});

	test("no response body carries a credential", async () => {
		const { base, create } = await start();
		const { id } = await create();
		const raw = await (await fetch(`${base}/v1/sessions/${id}`, { headers: auth })).text();
		expect(raw).not.toMatch(/sk-|api_key|refresh/);
	});
});
