/** Scope substitutions are restricted to live serving leases; SDK shims resolve the exact epoch at invocation. */
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_ACTIVATION_MARKER } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { ExtensionArtifacts } from "../../src/main/extension-artifacts.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "kc-served-epoch-"));
	roots.push(root);
	writeFileSync(join(root, "main.js"), `import "./value.js?activation=${DESKTOP_ACTIVATION_MARKER}";`);
	const artifacts = new ExtensionArtifacts("app://desktop");
	const revision = "a".repeat(64);
	const activation = "7a5685ff-9e0a-4d81-a3f1-9fb9343ab1ae";
	artifacts.register(
		{ owner: "example", revision, root, frontend: "main.js", styles: [], files: ["main.js"] },
		1,
		activation,
	);
	return { artifacts, activation, revision, url: `app://ext/example/${revision}/main.js` };
}

test("compiled placeholders are substituted only for that artifact's live activation lease", async () => {
	const { artifacts, activation, url } = fixture();
	expect((await artifacts.serve(new Request(url))).status).toBe(403);
	expect((await artifacts.serve(new Request(`${url}?activation=unknown`))).status).toBe(403);
	const served = await artifacts.serve(new Request(`${url}?activation=${activation}`));
	expect(served.status).toBe(200);
	expect(await served.text()).toContain(`?activation=${activation}`);
});

test("SDK functions resolve their captured scope at invocation instead of holding an obsolete host or using the window default", async () => {
	const { artifacts, activation, revision } = fixture();
	artifacts.runtime({ "@knightcodeai/cli/desktop": ["experimental_controllers"] });
	const url = `app://ext/runtime/${encodeURIComponent("@knightcodeai/cli/desktop")}.js`;
	expect((await artifacts.serve(new Request(url))).status).toBe(403);
	const response = await artifacts.serve(new Request(`${url}?activation=${activation}`));
	expect(response.status).toBe(200);
	expect(await response.text()).toContain("__knightcodeDesktopScopedRuntime");
	artifacts.release(1, "example", revision, activation);
	expect((await artifacts.serve(new Request(`${url}?activation=${activation}`))).status).toBe(403);
});
