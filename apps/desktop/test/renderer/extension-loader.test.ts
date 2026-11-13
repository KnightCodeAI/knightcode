import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import type { ResultOf } from "@knightcode/app-server-protocol";
import { expect, test } from "vitest";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";
import { FrontendExtensions } from "../../src/renderer/extensions/loader.ts";
const extension = (label: string) =>
	defineDesktopExtension((app) => {
		app.experimental_registerCommand({ id: "test", label: () => label, experimental_run: () => {} });
	});
const snapshot = (revision: string): ResultOf<"desktopExtension/list"> => ({
	safeMode: false,
	extensions: [
		{
			owner: "example",
			name: "example",
			source: "/example",
			scope: "user",
			enabled: true,
			approved: true,
			dev: true,
			diagnostics: [],
			artifact: { owner: "example", revision, root: "/cache", frontend: "app.js", styles: [], files: ["app.js"] },
		},
	],
});
test("failed preparation keeps the live set; disable and safe mode release it", async () => {
	const registry = new ExtensionRegistry();
	const disposed: string[] = [];
	const errors: string[] = [];
	const loader = new FrontendExtensions(
		registry,
		async (artifact) => {
			if (artifact.revision === "bad") throw new Error("CSS failed");
			return {
				extension: extension(artifact.revision),
				dispose: () => {
					disposed.push(artifact.revision);
				},
			};
		},
		(_owner, _revision, _phase, message) => {
			errors.push(message);
		},
	);
	await loader.update(snapshot("one"));
	await loader.update(snapshot("bad"));
	expect(registry.commandLabel(registry.commands({ sidebarOpen: true })[0]!, { sidebarOpen: true })).toBe("one");
	expect(errors).toContain("CSS failed");
	expect(disposed).toEqual([]);
	await loader.update({ ...snapshot("two"), safeMode: true });
	expect(registry.getSnapshot()).toEqual([]);
	expect(disposed).toEqual(["one"]);
	await loader.update(snapshot("three"));
	await loader.update({ safeMode: false, extensions: [] });
	expect(registry.getSnapshot()).toEqual([]);
	expect(disposed).toEqual(["one", "three"]);
});
test("an explicit reload remounts the same revision and disposes the previous activation", async () => {
	const registry = new ExtensionRegistry();
	let mounts = 0;
	let disposed = 0;
	const loader = new FrontendExtensions(
		registry,
		async () => ({
			extension: extension(`mount ${++mounts}`),
			dispose: () => {
				disposed++;
			},
		}),
		() => {},
	);
	await loader.update(snapshot("same"));
	const previous = registry.getSnapshot()[0]!;
	await loader.update(snapshot("same"), "reload");
	expect(registry.commandLabel(registry.commands({ sidebarOpen: true })[0]!, { sidebarOpen: true })).toBe("mount 2");
	expect(previous.signal.aborted).toBe(true);
	expect(disposed).toBe(1);
});

test("a late candidate cannot publish after disable", async () => {
	const registry = new ExtensionRegistry();
	let finish!: () => void;
	let disposed = 0;
	const loader = new FrontendExtensions(
		registry,
		async () => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return {
				extension: extension("late"),
				dispose: () => {
					disposed++;
				},
			};
		},
		() => {},
	);
	const pending = loader.update(snapshot("late"));
	await loader.update({ safeMode: false, extensions: [] });
	finish();
	await pending;
	expect(registry.getSnapshot()).toEqual([]);
	expect(disposed).toBe(1);
});
