import { describe, expect, it } from "vitest";
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";

const file = { target: { threadId: "t", projectCwd: "/p", cwd: "/p" }, path: "README.md" };

describe("file opener contributions", () => {
	it("keeps the named matcher tied to its registration, not its replacement", () => {
		const registry = new ExtensionRegistry();
		const extension = (label: string) =>
			defineDesktopExtension((app) => {
				app.experimental_registerPanelTab({ id: "viewer", label, experimental_render: () => null });
				app.experimental_registerFileOpener({
					id: "open",
					label,
					tab: "viewer",
					experimental_matches: ({ path }) => path.endsWith(".md"),
				});
			});
		const handle = registry.register("tools", extension("first"));
		const [old] = registry.fileOpeners(file);
		expect(old?.contribution.label).toBe("first");
		expect(registry.fileOpeners({ ...file, path: "data.bin" })).toEqual([]);
		registry.prepare("tools", extension("second"), "new").commit();
		handle.dispose();
		expect(old?.signal.aborted).toBe(true);
		expect(registry.fileOpeners(file).map((entry) => entry.contribution.label)).toEqual(["second"]);
	});
});
