import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
	// The preview switch is off by default; these cases exercise consent with it on.
	new DesktopExtensionManager(agent).setPreview(true);
	return { agent, source };
}
async function review(manager: DesktopExtensionManager, owner: string, cwd?: string) {
	return (await manager.list(cwd, owner)).extensions.find((entry) => entry.owner === owner)?.revision;
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("native desktop extensions preview switch", () => {
	it("off: approved packages are listed but nothing is staged or admitted", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({
			owner,
			source,
			approve: true,
			kinds: ["frontend"],
			enabled: true,
			revision: await review(manager, owner),
		});
		const on = await manager.candidates();
		expect(on.artifacts).toHaveLength(1);
		manager.setPreview(false);
		rmSync(join(agent, "desktop-artifacts"), { recursive: true, force: true });
		const off = await new DesktopExtensionManager(agent).list();
		expect(off.preview).toBe(false);
		expect(off.extensions[0]).toMatchObject({ owner, approved: true, enabled: true });
		expect(off.extensions[0]!.artifact).toBeUndefined();
		const candidates = await manager.candidates();
		expect(candidates.artifacts).toEqual([]);
		expect(candidates.enabled.size).toBe(0);
		expect(manager.admits(on.artifacts[0]!)).toBe(false);
		expect(existsSync(join(agent, "desktop-artifacts"))).toBe(false);
		manager.setPreview(true);
		expect((await manager.list()).preview).toBe(true);
		expect(manager.admits(on.artifacts[0]!)).toBe(true);
	});
	it("a malformed preview file leaves external code off instead of breaking the inventory", async () => {
		const { agent } = fixture();
		writeFileSync(join(agent, "desktop-extension-preview.json"), "{not json");
		const list = await new DesktopExtensionManager(agent).list();
		expect(list.preview).toBe(false);
		expect(list.extensions).toHaveLength(1);
	});
	it("a fresh agent directory starts with the preview off", async () => {
		const agent = mkdtempSync(join(tmpdir(), "kc-desktop-preview-"));
		roots.push(agent);
		expect((await new DesktopExtensionManager(agent).list()).preview).toBe(false);
	});
});
describe("desktop native consent", () => {
	it("requires fresh native-kind approval when a dev-approved frontend adds a backend", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		await manager.set({
			owner,
			source,
			approve: true,
			kinds: ["frontend"],
			dev: true,
			revision: await review(manager, owner),
		});
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
		await expect(
			manager.set({
				owner,
				source,
				approve: true,
				kinds: ["frontend"],
				dev: true,
				revision: await review(manager, owner),
			}),
		).rejects.toThrow(/kind|changed/i);
		await manager.set({
			owner,
			source,
			approve: true,
			kinds: ["frontend", "backend"],
			dev: true,
			revision: await review(manager, owner),
		});
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
		await manager.set({ owner, source, approve: true, kinds: ["backend"], revision: await review(manager, owner) });
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
		await manager.set({
			owner: initial.owner,
			approve: true,
			kinds: ["frontend"],
			source,
			enabled: true,
			revision: await review(manager, initial.owner),
		});
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
		await manager.set({
			owner,
			source,
			approve: true,
			kinds: ["frontend"],
			dev: true,
			enabled: true,
			revision: await review(manager, owner),
		});
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
		await manager.set({
			owner,
			source,
			approve: true,
			kinds: ["frontend"],
			enabled: true,
			revision: await review(manager, owner),
		});
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
			revision: await review(manager, entry.owner, project),
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
		await manager.set({ owner, source, approve: true, kinds: ["frontend"], revision: await review(manager, owner) });
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
	it.each([undefined, false, true])("returns a metadata-only review (development consent: %s)", async (dev) => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		const revision = await review(manager, owner);
		if (dev !== undefined) {
			await manager.set({ owner, source, approve: true, kinds: ["frontend"], revision, dev });
			expect((await manager.list()).extensions[0]?.artifact).toBeDefined();
		}
		const entry = (await manager.list(undefined, owner)).extensions[0]!;
		expect(entry).toMatchObject({ revision: expect.any(String), kinds: ["frontend"], approved: dev !== undefined });
		expect(entry).not.toHaveProperty("artifact");
		if (dev === undefined) expect((await manager.candidates()).artifacts).toEqual([]);
	});
	it("rejects an omitted approval revision without changing existing consent", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		const approval = { owner, source, approve: true, kinds: ["frontend" as const] };
		await manager.set({ ...approval, revision: await review(manager, owner), enabled: false });
		const file = join(agent, "desktop-extension-consent.json");
		const before = readFileSync(file, "utf8");
		await expect(manager.set({ ...approval, enabled: true, dev: true })).rejects.toThrow(/revision|confirmation/i);
		expect(readFileSync(file, "utf8")).toBe(before);
	});
	it("refuses to trust a revision other than the one staged for the confirmation", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent);
		const { owner } = (await manager.list()).extensions[0]!;
		const reviewed = (await manager.list(undefined, owner)).extensions[0]!;
		expect(reviewed.revision).toEqual(expect.any(String));
		writeFileSync(join(source, "app.js"), "export default { changed: true };\n");
		await expect(
			manager.set({
				owner,
				source,
				approve: true,
				kinds: ["frontend"],
				revision: reviewed.revision,
				enabled: true,
			}),
		).rejects.toThrow(/confirmation/i);
		expect(existsSync(join(agent, "desktop-extension-consent.json"))).toBe(false);
	});
});
describe("declared API and app version ranges", () => {
	const declare = (source: string, desktop: Record<string, unknown>) =>
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({ knightcode: { desktop: { frontend: "./app.js", ...desktop } } }),
		);
	it("refuses an app range that excludes the running desktop before staging either half", async () => {
		const { agent, source } = fixture();
		writeFileSync(join(source, "server.js"), 'throw new Error("backend must not execute"); export default {};');
		declare(source, { backend: "./server.js", app: ">=0.2.0" });
		const manager = new DesktopExtensionManager(agent, { appVersion: "0.1.2" });
		const entry = (await manager.list()).extensions[0]!;
		expect(entry.error).toBe(
			"Requires KnightCode desktop >=0.2.0; this is 0.1.2. Update the app or install a compatible version.",
		);
		expect(entry.kinds).toBeUndefined();
		await expect(
			manager.set({ owner: entry.owner, source, approve: true, kinds: ["frontend", "backend"] }),
		).rejects.toThrow(/Requires KnightCode desktop/);
		expect((await manager.candidates()).artifacts).toEqual([]);
		expect(existsSync(join(agent, "desktop-artifacts"))).toBe(false);
		const compatible = new DesktopExtensionManager(agent, { appVersion: "0.2.1" });
		expect((await compatible.list()).extensions[0]!.error).toBeUndefined();
	});
	it("refuses an unsupported declared API version and malformed ranges with clear diagnostics", async () => {
		const { agent, source } = fixture();
		const manager = new DesktopExtensionManager(agent, { appVersion: "0.1.2" });
		declare(source, { apiVersion: 2 });
		expect((await manager.list()).extensions[0]!.error).toBe(
			"Requires desktop extension API 2; this app supports API 1.",
		);
		declare(source, { app: "not a range" });
		expect((await manager.list()).extensions[0]!.error).toBe('desktop.app must be a semver range such as ">=0.2.0".');
		declare(source, { apiVersion: "1" });
		expect((await manager.list()).extensions[0]!.error).toBe("desktop.apiVersion must be an integer.");
		declare(source, { apiVersion: 1, app: "^0.1.0" });
		expect((await manager.list()).extensions[0]!.error).toBeUndefined();
	});
	it("checks only the declared range when no desktop app version is known (CLI validation)", async () => {
		const { agent, source } = fixture();
		declare(source, { app: ">=99.0.0" });
		expect((await new DesktopExtensionManager(agent).list()).extensions[0]!.error).toBeUndefined();
	});
});
