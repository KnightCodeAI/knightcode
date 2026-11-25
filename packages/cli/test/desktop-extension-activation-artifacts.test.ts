/** Every local ESM edge and SDK import carries the exact frontend activation, including unchanged-file reloads. */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESKTOP_ACTIVATION_MARKER } from "@knightcode/app-server-protocol";
import { afterEach, expect, test } from "vitest";
import { stageDesktopRevision } from "../src/app-server/desktop-extensions/artifacts.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "kc-epoch-modules-"));
	roots.push(root);
	const source = join(root, "source");
	mkdirSync(source);
	writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "./main.js" } } }));
	writeFileSync(
		join(source, "main.js"),
		'import { defineDesktopExtension } from "@knightcodeai/cli/desktop"; import { value } from "./value.js"; export default defineDesktopExtension(app => {});',
	);
	writeFileSync(join(source, "value.js"), "export const value = 1;");
	return { root, source };
}

test("the entry, transitive local modules and shared SDK resolve through an activation-specific module graph", async () => {
	const { source, root } = fixture();
	const artifact = await stageDesktopRevision(source, join(root, "cache"), "example");
	const entry = readFileSync(join(artifact.root, artifact.frontend), "utf8");
	const module = readFileSync(join(artifact.root, "main.js"), "utf8");
	expect(entry).toContain(`?activation=${DESKTOP_ACTIVATION_MARKER}`);
	expect(module).toContain(`value.js?activation=${DESKTOP_ACTIVATION_MARKER}`);
	expect(module).toContain(`desktop.js?activation=${DESKTOP_ACTIVATION_MARKER}`);
});

test("author source cannot introduce a host-substituted activation marker into unrelated data", async () => {
	const { source, root } = fixture();
	writeFileSync(join(source, "value.js"), `export const value = ${JSON.stringify(DESKTOP_ACTIVATION_MARKER)};`);
	await expect(stageDesktopRevision(source, join(root, "cache"), "example")).rejects.toThrow(/reserved.*activation/i);
});
