import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopDevelopmentWatcher } from "../src/app-server/desktop-extensions/watch.ts";
import { DesktopExtensionManager } from "../src/app-server/desktop-extensions/manager.ts";
const roots: string[] = [];
const watchers: DesktopDevelopmentWatcher[] = [];
afterEach(() => {
	for (const watcher of watchers.splice(0)) watcher.dispose();
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
describe("desktop development directory watch", () => {
	it("watches nested changes only after explicit dev consent, then stops on disable and disposal", async () => {
		const agent = mkdtempSync(join(tmpdir(), "kc-desktop-watch-"));
		roots.push(agent);
		const source = join(agent, "desktop-extensions", "notice");
		mkdirSync(join(source, "nested"), { recursive: true });
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(join(source, "app.js"), "export default {};");
		let reloads = 0;
		const manager = new DesktopExtensionManager(agent);
		manager.setPreview(true);
		const watcher = new DesktopDevelopmentWatcher(() => {
			reloads++;
		});
		watchers.push(watcher);
		watcher.update(await manager.list());
		writeFileSync(join(source, "nested", "file.css"), ".notice {}");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(reloads).toBe(0);
		const entry = (await manager.list()).extensions[0]!;
		const reviewed = (await manager.list(undefined, entry.owner)).extensions[0]!;
		await manager.set({
			owner: entry.owner,
			source,
			approve: true,
			kinds: ["frontend"],
			revision: reviewed.revision,
			dev: true,
		});
		watcher.update(await manager.list());
		writeFileSync(join(source, "nested", "file.css"), ".notice {color:red}");
		await expect.poll(() => reloads).toBe(1);
		await manager.set({ owner: entry.owner, enabled: false });
		watcher.update(await manager.list());
		writeFileSync(join(source, "nested", "file.css"), ".notice {color:blue}");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(reloads).toBe(1);
		await manager.set({ owner: entry.owner, enabled: true });
		watcher.update(await manager.list());
		watcher.dispose();
		writeFileSync(join(source, "app.js"), "export default {apiVersion:2};");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(reloads).toBe(1);
	});
	it("safe mode never installs directory watches", async () => {
		let reloads = 0;
		const watcher = new DesktopDevelopmentWatcher(() => {
			reloads++;
		});
		watchers.push(watcher);
		watcher.update({
			safeMode: true,
			preview: true,
			extensions: [
				{
					owner: "x",
					source: "missing",
					name: "x",
					scope: "user",
					approved: true,
					enabled: true,
					dev: true,
					diagnostics: [],
				},
			],
		});
		expect(reloads).toBe(0);
	});
	it("the preview switch off installs no watches even for dev-approved sources", async () => {
		const agent = mkdtempSync(join(tmpdir(), "kc-desktop-watch-"));
		roots.push(agent);
		const source = join(agent, "desktop-extensions", "notice");
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./app.js" } } }));
		writeFileSync(join(source, "app.js"), "export default {};");
		const manager = new DesktopExtensionManager(agent);
		manager.setPreview(true);
		const entry = (await manager.list()).extensions[0]!;
		const reviewed = (await manager.list(undefined, entry.owner)).extensions[0]!;
		await manager.set({
			owner: entry.owner,
			source,
			approve: true,
			kinds: ["frontend"],
			revision: reviewed.revision,
			dev: true,
			enabled: true,
		});
		manager.setPreview(false);
		let reloads = 0;
		const watcher = new DesktopDevelopmentWatcher(() => {
			reloads++;
		});
		watchers.push(watcher);
		watcher.update(await manager.list());
		writeFileSync(join(source, "app.js"), "export default {apiVersion:1};");
		await new Promise((resolve) => setTimeout(resolve, 250));
		expect(reloads).toBe(0);
	});
});
