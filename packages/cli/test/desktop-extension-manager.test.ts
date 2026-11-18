import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopExtensionManager } from "../src/app-server/desktop-extensions/manager.ts";
import { ProjectTrustStore } from "../src/core/trust-manager.ts";
const roots: string[] = [];
function fixture() {
	const agent = mkdtempSync(join(tmpdir(), "kc-desktop-manager-"));
	roots.push(agent);
	const source = join(agent, "desktop-extensions", "example");
	mkdirSync(source, { recursive: true });
	writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
	writeFileSync(join(source, "app.js"), 'throw new Error("source must not execute in server"); export default {};');
	return { agent, source };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("desktop native consent", () => {
	it("requires fresh native-kind approval when a dev-approved frontend adds a backend", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({ owner, source, approve: true, kinds: ["frontend"], dev: true });
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({ knightcode: { desktop: { frontend: "./app.js", backend: "./server.js" } } }),
		);
		writeFileSync(join(source, "server.js"), 'throw new Error("backend must not execute"); export default {};');
		const changed = (await manager.list()).extensions[0]!;
		expect(changed.kinds).toEqual(["frontend", "backend"]);
		expect(changed.approved).toBe(false);
		expect(changed.artifact).toBeUndefined();
		await expect(manager.set({ owner, enabled: true })).rejects.toThrow(/consent/i);
		await expect(manager.set({ owner, source, approve: true, kinds: ["frontend"], dev: true })).rejects.toThrow(
			/kind|changed/i,
		);
		await manager.set({ owner, source, approve: true, kinds: ["frontend", "backend"], dev: true });
		const approved = (await manager.list()).extensions[0]!;
		expect(approved.approved).toBe(true);
		expect(approved.artifact?.backend).toBe("__backend/server.js");
		expect(approved.error).toBeUndefined();
		const saved = JSON.parse(readFileSync(join(agent, "desktop-extension-consent.json"), "utf8"));
		expect(saved[owner].kinds).toEqual(["frontend", "backend"]);
	});

	it("safe mode does not even stage an approved backend-only graph", async () => {
		const { agent, source } = fixture();
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({ knightcode: { desktop: { backend: "./server.js" } } }),
		);
		writeFileSync(join(source, "server.js"), 'throw new Error("backend must not execute"); export default {};');
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({ owner, source, approve: true, kinds: ["backend"] });
		rmSync(join(source, "server.js"));
		rmSync(join(agent, "desktop-artifacts"), { recursive: true, force: true });
		const safe = (await new DesktopExtensionManager(agent, { safeMode: true }).list()).extensions[0]!;
		expect(safe.approved).toBe(true);
		expect(safe.artifact).toBeUndefined();
		expect(safe.error).toBeUndefined();
	});
	it("requires separate consent and pins non-development content across restarts", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const initial = (await manager.list()).extensions[0]!;
		expect(initial.approved).toBe(false);
		expect(initial.artifact).toBeUndefined();
		await expect(manager.set({ owner: initial.owner, enabled: true })).rejects.toThrow(/consent/i);
		await manager.set({ owner: initial.owner, approve: true, kinds: ["frontend"], source, enabled: true });
		const approved = (await new DesktopExtensionManager(agent).list()).extensions[0]!;
		expect(approved.artifact).toBeDefined();
		writeFileSync(join(source, "app.js"), "export default {apiVersion:2};");
		const changed = (await manager.list()).extensions[0]!;
		expect(changed.artifact).toBeUndefined();
		expect(changed.error).toMatch(/consent|changed/i);
		expect(readFileSync(join(agent, "desktop-extension-consent.json"), "utf8")).toContain("frontend");
	});
	it("allows explicitly approved development reloads but not safe-mode staging", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({ owner, source, approve: true, kinds: ["frontend"], dev: true, enabled: true });
		const first = (await manager.list()).extensions[0]!.artifact!.revision;
		writeFileSync(join(source, "app.js"), "export default {apiVersion:1};");
		expect((await manager.list()).extensions[0]!.artifact!.revision).not.toBe(first);
		expect(
			(await new DesktopExtensionManager(agent, { safeMode: true }).list()).extensions[0]!.artifact,
		).toBeUndefined();
		await manager.set({ owner, enabled: false });
		expect((await manager.list()).extensions[0]!.artifact).toBeUndefined();
	});
	it("revokes native consent rather than just disabling execution", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({ owner, source, approve: true, kinds: ["frontend"], enabled: true });
		await manager.set({ owner, revoke: true });
		const revoked = (await manager.list()).extensions[0]!;
		expect(revoked.approved).toBe(false);
		expect(revoked.artifact).toBeUndefined();
		await expect(manager.set({ owner, enabled: true })).rejects.toThrow(/consent/i);
	});
	it("project trust is required in addition to native consent and revocation removes the artifact", async () => {
		const { agent } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const project = join(agent, "project");
		const source = join(project, ".knightcode", "native");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(project, ".knightcode", "settings.json"), JSON.stringify({ packages: ["./native"] }));
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(join(source, "app.js"), 'throw new Error("never evaluate in server"); export default {};');
		expect((await manager.list(project)).extensions.filter((entry) => entry.scope === "project")).toEqual([]);
		const trust = new ProjectTrustStore(agent);
		trust.set(project, true);
		const entry = (await manager.list(project)).extensions.find((entry) => entry.scope === "project")!;
		expect(entry.artifact).toBeUndefined();
		await manager.set({
			owner: entry.owner,
			cwd: project,
			source: entry.source,
			approve: true,
			kinds: ["frontend"],
			enabled: true,
		});
		expect((await manager.list()).extensions.find((item) => item.owner === entry.owner)?.artifact).toBeDefined();
		trust.set(project, false);
		expect((await manager.list()).extensions.find((item) => item.owner === entry.owner)).toBeUndefined();
	});
	it("cannot enable a newly declared native kind with a consent record that did not approve it", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({ owner, source, approve: true, kinds: ["frontend"] });
		const file = join(agent, "desktop-extension-consent.json");
		const records = JSON.parse(readFileSync(file, "utf8")) as Record<string, { kinds: string[] }>;
		records[owner]!.kinds = [];
		writeFileSync(file, JSON.stringify(records));
		await expect(manager.set({ owner, enabled: true })).rejects.toThrow(/consent/i);
		expect((await manager.list()).extensions[0]!.approved).toBe(false);
	});
	it("refuses consent if the source identity changed", async () => {
		const { agent } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await expect(manager.set({ owner, source: "another-source", approve: true })).rejects.toThrow(/source/i);
	});
});
