import { fauxAssistantMessage } from "@knightcode/ai";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

test("config/write is compare-and-swap; config/read reports settings, origins and version of one read (§4.4)", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ theme: "dark" })); // after the server loaded
	const read = await a.client.request("config/read", {});
	expect((read.settings as { theme?: string }).theme).toBe("dark"); // not the state loaded at startup
	const written = await a.client.request("config/write", {
		scope: "global",
		key: "defaultThinkingLevel",
		value: "high",
		expectedVersion: read.versions.global,
	});
	await expect(
		a.client.request("config/write", {
			scope: "global",
			key: "theme",
			value: "light",
			expectedVersion: read.versions.global,
		}),
	).rejects.toMatchObject({ code: "configConflict" });
	const after = await a.client.request("config/read", {});
	expect(after.versions.global).toBe(written.version);
	expect(after.settings).toMatchObject({ theme: "dark", defaultThinkingLevel: "high" });
	expect(after.origins.defaultThinkingLevel).toBe("global");
	expect(after.errors).toEqual([]);
});

test("config/write deletes a key exposed by migration, without it reappearing on config/read", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	const file = join(agentDir, "settings.json");
	writeFileSync(file, JSON.stringify({ queueMode: "all", theme: "dark" }));
	const before = await a.client.request("config/read", {});
	expect(before.settings).toMatchObject({ steeringMode: "all" });
	await a.client.request("config/write", {
		scope: "global",
		key: "steeringMode",
		value: null,
		expectedVersion: before.versions.global,
	});
	const after = await a.client.request("config/read", {});
	expect(after.settings).toEqual({ theme: "dark" });
	expect(after.origins).not.toHaveProperty("steeringMode");
	expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ theme: "dark" });
});

test("config/read returns a settings file's parse error with its position", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	writeFileSync(join(agentDir, "settings.json"), '{\n  "theme": \n}');
	const read = await a.client.request("config/read", {});
	expect(read.errors).toHaveLength(1);
	expect(read.errors[0]).toMatchObject({ source: "settings" });
	expect(String(read.errors[0].path)).toContain("settings.json");
});

test("project trust can be read and set; trusted project keys report their origin (§4.4)", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "settings.json"), JSON.stringify({ theme: "light" }));
	const a = await connect();
	expect(await a.client.request("project/trust/read", { cwd })).toEqual({
		trusted: null,
		needsTrust: true,
		project: cwd,
	});
	await a.client.request("project/trust/set", { cwd, trusted: true });
	expect(await a.client.request("project/trust/read", { cwd })).toEqual({
		trusted: true,
		needsTrust: true,
		project: cwd,
	});
	const missing = `${cwd}-missing`; // not under cwd, whose trust it would inherit
	await expect(a.client.request("project/trust/set", { cwd: missing, trusted: true })).rejects.toMatchObject({
		code: "invalidParams",
	});
	expect(await a.client.request("project/trust/read", { cwd: missing })).toMatchObject({ trusted: null });
	const read = await a.client.request("config/read", { cwd });
	expect(read.origins.theme).toBe("project");
});

test("load-time warnings come back in the response that loaded the thread, not as broadcasts", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode", "extensions"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "extensions", "broken.ts"), "export default ( =>");
	const a = await connect("desktop");
	const other = await connect("desktop");
	await a.client.request("project/trust/set", { cwd, trusted: true });
	const { thread, warnings } = await a.client.request("thread/start", { cwd });
	expect(warnings.some((w) => w.source === "extension" && String(w.path).includes("broken.ts"))).toBe(true);
	const resumed = await other.client.request("thread/resume", { threadId: thread.id });
	expect(resumed.warnings).toEqual(warnings); // a second window sees the same load diagnostics
	expect(other.notifications.some((n) => n.method === "warning")).toBe(false);
});

test("an undecided project's skipped resources are reported as a trust warning", async () => {
	const { cwd, connect } = await startServer();
	mkdirSync(join(cwd, ".knightcode"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "settings.json"), JSON.stringify({ theme: "light" }));
	const a = await connect();
	const { warnings } = await a.client.request("thread/start", { cwd });
	expect(warnings.filter((w) => w.source === "trust")).toHaveLength(1);
});

test("corrupt config/write rejects without writing; project writes require cwd and trust", async () => {
	const { cwd, agentDir, connect } = await startServer();
	const a = await connect();
	const file = join(agentDir, "settings.json");
	writeFileSync(file, "{ broken");
	await expect(a.client.request("config/write", { scope: "global", key: "theme", value: "light" })).rejects.toThrow();
	expect(readFileSync(file, "utf8")).toBe("{ broken");
	await expect(
		a.client.request("config/write", { scope: "project", key: "theme", value: "light" }),
	).rejects.toMatchObject({ code: "invalidParams" });
	await expect(
		a.client.request("config/write", { scope: "project", cwd, key: "theme", value: "light" }),
	).rejects.toMatchObject({ code: "invalidParams", data: { reason: "untrusted" } });
	await a.client.request("project/trust/set", { cwd, trusted: true });
	const written = await a.client.request("config/write", {
		scope: "project",
		cwd,
		key: "theme",
		value: "light",
		expectedVersion: "none",
	});
	const read = await a.client.request("config/read", { cwd });
	expect(read.versions.project).toBe(written.version);
	expect(read.origins.theme).toBe("project");
	await expect(
		a.client.request("config/write", { scope: "global", key: "__proto__.polluted", value: true }),
	).rejects.toMatchObject({ code: "invalidParams" });
	for (const key of ["", "a..b"])
		await expect(a.client.request("config/write", { scope: "global", key, value: true })).rejects.toMatchObject({
			code: "invalidParams",
		});
});

test("load settings and runner warnings are responses; later runner warnings go only to subscribers", async () => {
	const { cwd, faux, connect } = await startServer({
		extraExtensions: [
			{
				name: "broken-hooks",
				factory: (k) => {
					k.on("session_start", () => {
						throw new Error("load hook failed");
					});
					k.on("input", () => {
						throw new Error("input hook failed");
					});
				},
			},
		],
	});
	mkdirSync(join(cwd, ".knightcode"), { recursive: true });
	writeFileSync(join(cwd, ".knightcode", "settings.json"), "{ bad");
	const a = await connect();
	const sidebar = await connect();
	await a.client.request("project/trust/set", { cwd, trusted: true });
	const started = await a.client.request("thread/start", { cwd });
	expect(started.warnings).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ source: "settings", path: join(cwd, ".knightcode", "settings.json") }),
			expect.objectContaining({ source: "extension", message: "load hook failed" }),
		]),
	);
	expect(a.notifications.some((n) => n.method === "warning")).toBe(false);
	expect(sidebar.notifications.some((n) => n.method === "warning")).toBe(false);
	faux.setResponses([fauxAssistantMessage("done")]);
	await a.client.request("turn/start", { threadId: started.thread.id, text: "go" });
	await a.waitFor("turn/completed");
	expect(await a.waitFor("warning")).toMatchObject({
		threadId: started.thread.id,
		source: "extension",
		message: "input hook failed",
	});
	expect(sidebar.notifications.some((n) => n.method === "warning")).toBe(false);
	const resumed = await sidebar.client.request("thread/resume", { threadId: started.thread.id });
	expect(resumed.warnings).toEqual(started.warnings);
	const forked = await a.client.request("thread/fork", { threadId: started.thread.id });
	expect(forked.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ message: "load hook failed" })]));
});
