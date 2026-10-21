import { ClientRequests } from "@knightcode/app-server-protocol";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { afterEach, expect, test } from "vitest";
import { cleanupServers, startServer } from "./harness.ts";

afterEach(cleanupServers);

/** The server does not check its own results, so the tests do: a field the schema lacks would break clients. */
const conforms = (method: keyof typeof ClientRequests, result: unknown) =>
	expect(Compile(ClientRequests[method].result).Check(result), method).toBe(true);

const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8"));

test("config/read reports the defaults and the settings files' paths", async () => {
	const { cwd, agentDir, connect } = await startServer();
	const a = await connect();
	const read = await a.client.request("config/read", { cwd });
	conforms("config/read", read);
	expect(read.defaults).toMatchObject({ compaction: { enabled: true }, transport: "auto" });
	expect(read.paths).toEqual({
		global: join(agentDir, "settings.json"),
		project: join(cwd, ".knightcode", "settings.json"),
	});
});

test("tool settings are written to tools.json; stored keys come back masked", async () => {
	const { agentDir, connect } = await startServer();
	const a = await connect();
	await a.client.request("tool/settings/write", { name: "websearch", key: "enabled", value: true });
	await a.client.request("tool/settings/write", { name: "websearch", key: "braveApiKey", value: "secret-1234" });
	expect(readJson(join(agentDir, "tools.json"))).toEqual({ websearch: { enabled: true, braveApiKey: "secret-1234" } });
	const read = await a.client.request("tool/settings/read", {});
	conforms("tool/settings/read", read);
	expect(read.tools.find((t) => t.name === "websearch")).toEqual({
		name: "websearch",
		enabled: true,
		settings: { braveApiKey: "••••1234" },
	});
	expect(read.tools.find((t) => t.name === "webfetch")).toMatchObject({ enabled: false });
	await a.client.request("tool/settings/write", { name: "websearch", key: "braveApiKey", value: null });
	expect(readJson(join(agentDir, "tools.json"))).toEqual({ websearch: { enabled: true } });
	for (const params of [
		{ name: "nope", key: "enabled", value: true },
		{ name: "websearch", key: "enabled", value: "yes" },
		{ name: "websearch", key: "__proto__", value: "x" },
	])
		await expect(a.client.request("tool/settings/write", params)).rejects.toMatchObject({ code: "invalidParams" });
});

test("tool/list lists the tools a new thread would have and the resolved defaultTools", async () => {
	const { cwd, connect } = await startServer();
	const a = await connect();
	const listed = await a.client.request("tool/list", { cwd });
	conforms("tool/list", listed);
	expect(listed.tools.find((t) => t.name === "read")).toMatchObject({ source: "builtin" });
	expect(listed.defaultTools).toEqual(["read", "bash", "edit", "write"]);
	await a.client.request("config/write", { scope: "global", key: "defaultTools", value: ["-bash"] });
	expect((await a.client.request("tool/list", {})).defaultTools).toEqual(["read", "edit", "write"]);
});

test("MCP servers can be added, changed and removed; project files need trust", async () => {
	const { cwd, agentDir, connect } = await startServer();
	const a = await connect();
	const global = join(agentDir, "mcp.json");
	expect(
		await a.client.request("mcp/add", {
			scope: "global",
			name: "files",
			config: { command: "node", args: ["server.js"] },
		}),
	).toEqual({ replaced: false });
	await a.client.request("mcp/update", { name: "files", enabled: false, exposure: "direct" });
	expect(readJson(global)).toEqual({
		mcpServers: { files: { command: "node", args: ["server.js"], enabled: false, exposure: "direct" } },
	});
	expect((await a.client.request("mcp/list", {})).servers).toEqual([
		{
			name: "files",
			scope: "global",
			source: global,
			transport: "stdio",
			target: "node server.js",
			enabled: false,
			exposure: "direct",
		},
	]);
	await expect(
		a.client.request("mcp/add", { scope: "global", name: "bad", config: { args: [] } }),
	).rejects.toMatchObject({ code: "invalidParams" });
	const docs = { url: "https://example.com/mcp" };
	await expect(
		a.client.request("mcp/add", { scope: "project", cwd, name: "docs", config: docs }),
	).rejects.toMatchObject({ code: "invalidParams", data: { reason: "untrusted" } });
	await a.client.request("project/trust/set", { cwd, trusted: true });
	await a.client.request("mcp/add", { scope: "project", cwd, name: "docs", config: docs });
	// A project override of a global server is changed in the project file, as /mcp does.
	const project = join(cwd, ".knightcode", "mcp.json");
	writeFileSync(project, JSON.stringify({ mcpServers: { ...readJson(project).mcpServers, files: { enabled: true } } }));
	await a.client.request("mcp/update", { cwd, name: "files", exposure: "deferred" });
	expect(readJson(project).mcpServers.files).toEqual({ enabled: true, exposure: "deferred" });
	const listed = await a.client.request("mcp/list", { cwd });
	conforms("mcp/list", listed);
	expect(listed.paths).toEqual({ global, project });
	expect(listed.servers.map((s) => [s.name, s.scope, s.enabled, s.exposure, s.override])).toEqual([
		["files", "global", true, "deferred", project],
		["docs", "project", true, "codemode", undefined],
	]);
	expect(await a.client.request("mcp/remove", { scope: "global", name: "files" })).toEqual({ removed: true });
	expect(await a.client.request("mcp/remove", { scope: "global", name: "files" })).toEqual({ removed: false });
});

test("resources are listed and toggled as knightcode config does", async () => {
	const { cwd, agentDir, connect } = await startServer();
	mkdirSync(join(agentDir, "skills", "demo"), { recursive: true });
	writeFileSync(join(agentDir, "skills", "demo", "SKILL.md"), "---\nname: demo\ndescription: A demo\n---\nBody\n");
	const a = await connect();
	const listed = await a.client.request("resource/list", { cwd });
	conforms("resource/list", listed);
	const skill = listed.resources.find((r) => r.type === "skills" && r.name === "demo");
	expect(skill).toMatchObject({ enabled: true, scope: "user", origin: "top-level" });
	// Built-in extensions are part of KnightCode, always on: never offered for turning off.
	expect(listed.resources.some((r) => r.source === "builtin")).toBe(false);

	await a.client.request("resource/set", { type: "skills", path: skill!.path, enabled: false });
	expect(readJson(join(agentDir, "settings.json")).skills).toEqual([`-${join("skills", "demo", "SKILL.md")}`]);
	const after = await a.client.request("resource/list", {});
	expect(after.resources.find((r) => r.path === skill!.path)?.enabled).toBe(false);

	await a.client.request("resource/set", { type: "skills", path: skill!.path, enabled: true });
	expect(readJson(join(agentDir, "settings.json")).skills).toEqual([`+${join("skills", "demo", "SKILL.md")}`]);
	for (const [type, path] of [
		["skills", join(agentDir, "nope.md")],
		["extensions", "builtin:mcp"],
	] as const)
		await expect(a.client.request("resource/set", { type, path, enabled: false })).rejects.toMatchObject({
			code: "invalidParams",
		});
});
