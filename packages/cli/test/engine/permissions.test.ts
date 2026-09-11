import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { fauxAssistantMessage, fauxProvider, type FauxProviderHandle, fauxText, fauxToolCall } from "@knightcode/ai";
import type { ToolResultMessage } from "@knightcode/ai";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import type { AgentSession } from "../../src/core/agent-session.ts";
import { createAgentSessionFromServices, createAgentSessionServices } from "../../src/core/agent-session-services.ts";
import { SessionManager } from "../../src/core/session-manager.ts";
import { type ClientRequests, createClientRequests } from "../../src/engine/client-requests.ts";
import { createEngineContext } from "../../src/engine/context.ts";
import { type EngineEvent } from "../../src/engine/events.ts";
import { createPermissionExtension } from "../../src/engine/permissions.ts";

type RequestEvent = Extract<EngineEvent, { type: "session.request" }>;

async function until(predicate: () => boolean, ms = 3000): Promise<void> {
	const deadline = Date.now() + ms;
	while (!predicate()) {
		if (Date.now() > deadline) throw new Error("timed out waiting");
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
}

describe("permission extension", () => {
	let counter = 0;
	const dirs: string[] = [];
	let session: AgentSession | undefined;

	afterEach(() => {
		session?.dispose();
		session = undefined;
		for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	});

	async function start(): Promise<{
		cwd: string;
		faux: FauxProviderHandle;
		requests: ClientRequests;
		permissions: RequestEvent[];
		allRequests: RequestEvent[];
	}> {
		const cwd = mkdtempSync(join(tmpdir(), "knightcode-test-permissions-"));
		const agentDir = mkdtempSync(join(tmpdir(), "knightcode-test-permissions-agent-"));
		dirs.push(cwd, agentDir);
		const ctx = await createEngineContext({ credentials: new InMemoryCredentialStore(), modelsPath: null });
		const faux = fauxProvider({ provider: `faux-permissions-${counter++}` });
		ctx.models.registerNativeProvider(faux.provider);
		const allRequests: RequestEvent[] = [];
		ctx.events.subscribe((event) => {
			if (event.type === "session.request") allRequests.push(event);
		});
		const requests = createClientRequests(ctx.events);
		const services = await createAgentSessionServices({
			cwd,
			agentDir,
			modelRuntime: ctx.models,
			resourceLoaderOptions: { extensionFactories: [createPermissionExtension("s1", requests)] },
		});
		const created = await createAgentSessionFromServices({
			services,
			sessionManager: SessionManager.inMemory(cwd),
			model: faux.getModel(),
		});
		session = created.session;
		const permissions = allRequests;
		return { cwd, faux, requests, permissions, allRequests };
	}

	function toolResult(): ToolResultMessage | undefined {
		return session?.messages.find((message): message is ToolResultMessage => message.role === "toolResult");
	}

	test("holds the tool until the client answers, and a rejection fails only that call", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("carried on")]),
		]);
		const turn = session!.prompt("write a file", { source: "rpc" });
		await until(() => permissions.length === 1);
		const [request] = permissions;
		expect(request.request).toMatchObject({ kind: "permission", toolName: "write" });
		expect(session!.isStreaming).toBe(true);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);

		expect(requests.reply(request.requestId, { kind: "permission", outcome: "reject_once" })).toBe(true);
		await turn;
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(toolResult()?.isError).toBe(true);
		expect(JSON.stringify(toolResult()?.content)).toContain("rejected");
		expect(session!.getLastAssistantText()).toBe("carried on");
	});

	test("allow_always answers the next call of the same tool without asking", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "one" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxToolCall("write", { path: "b.txt", content: "two" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("done")]),
		]);
		const turn = session!.prompt("write two files", { source: "rpc" });
		await until(() => permissions.length === 1);
		requests.reply(permissions[0].requestId, { kind: "permission", outcome: "allow_always" });
		await turn;
		expect(permissions.length).toBe(1);
		expect(existsSync(join(cwd, "a.txt"))).toBe(true);
		expect(existsSync(join(cwd, "b.txt"))).toBe(true);
	});

	test("a read never asks", async () => {
		const { cwd, faux, allRequests } = await start();
		writeFileSync(join(cwd, "a.txt"), "content");
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("read", { path: "a.txt" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("read it")]),
		]);
		await session!.prompt("read a file", { source: "rpc" });
		expect(allRequests).toEqual([]);
		expect(toolResult()?.isError).toBe(false);
	});

	test("aborting the turn releases a pending permission and runs nothing", async () => {
		const { cwd, faux, requests, permissions } = await start();
		faux.setResponses([
			fauxAssistantMessage([fauxToolCall("write", { path: "a.txt", content: "hello" })], { stopReason: "toolUse" }),
			fauxAssistantMessage([fauxText("never")]),
		]);
		const turn = session!.prompt("write a file", { source: "rpc" });
		await until(() => permissions.length === 1);
		const settled = Promise.all([turn, session!.abort()]);
		await Promise.race([
			settled,
			new Promise((_, reject) => setTimeout(() => reject(new Error("abort did not settle the turn")), 3000)),
		]);
		expect(session!.isIdle).toBe(true);
		expect(existsSync(join(cwd, "a.txt"))).toBe(false);
		expect(requests.size()).toBe(0);
	});
});
