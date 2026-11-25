import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopArtifact } from "../src/app-server/desktop-extensions/artifacts.ts";

async function stageDesktopExtension(source: string, cache: string, _owner: string): Promise<DesktopArtifact> {
	return JSON.parse(
		execFileSync("bun", [fileURLToPath(new URL("./fixtures/desktop-stage.ts", import.meta.url)), source, cache], {
			encoding: "utf8",
			windowsHide: true,
			stdio: ["ignore", "pipe", "pipe"],
		}),
	);
}

const roots: string[] = [];
function fixture() {
	const root = mkdtempSync(join(tmpdir(), "kc-desktop-artifacts-"));
	roots.push(root);
	const source = join(root, "source");
	mkdirSync(source);
	writeFileSync(
		join(source, "package.json"),
		JSON.stringify({ knightcode: { desktop: { frontend: "./app.tsx", styles: ["./app.css"] } } }),
	);
	writeFileSync(
		join(source, "app.tsx"),
		'import {defineDesktopExtension} from "@knightcodeai/cli/desktop"; import {Label} from "./label.tsx"; export default defineDesktopExtension(app => { app.experimental_registerSlot({id:"label", surface:"feedback", experimental_render: () => <Label/>}); });',
	);
	writeFileSync(
		join(source, "label.tsx"),
		'export const Label = () => <span className="external-only">External</span>;',
	);
	writeFileSync(join(source, "app.css"), ".external-only { color: red; }");
	return { source, cache: join(root, "cache") };
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("desktop extension artifacts", () => {
	it("stages an immutable multi-file TSX revision without executing source", async () => {
		const { source, cache } = fixture();
		const first = await stageDesktopExtension(source, cache, "example");
		expect(readFileSync(join(first.root, "app.js"), "utf8")).toContain("app://ext/runtime/");
		expect(readFileSync(join(first.root, "label.js"), "utf8")).toContain("createElement");
		expect(readFileSync(join(first.root, first.styles[0]!), "utf8")).toContain("@scope");
		expect((await stageDesktopExtension(source, cache, "example")).revision).toBe(first.revision);
		writeFileSync(join(source, "label.tsx"), "export const Label = () => <span>New</span>;");
		const next = await stageDesktopExtension(source, cache, "example");
		expect(next.revision).not.toBe(first.revision);
		expect(readFileSync(join(first.root, "label.js"), "utf8")).toContain("External");
	});
	it("addresses validated output rather than discarded CSS comments", async () => {
		const { source, cache } = fixture();
		const first = await stageDesktopExtension(source, cache, "example");
		writeFileSync(join(source, "app.css"), "/* does not affect the artifact */.external-only { color: red; }");
		const second = await stageDesktopExtension(source, cache, "example");
		expect(second.revision).toBe(first.revision);
		expect(readFileSync(join(second.root, second.styles[0]!), "utf8")).not.toContain("does not affect");
	});
	it("resolves local CSS imports/assets and global names across the stylesheet set without rewriting literals", async () => {
		const { source, cache } = fixture();
		mkdirSync(join(source, "styles"));
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({
				knightcode: { desktop: { frontend: "./app.tsx", styles: ["./app.css", "./styles/other.css"] } },
			}),
		);
		writeFileSync(join(source, "app.css"), '@import "./styles/nested.css"; @keyframes pulse {to {opacity:0}}');
		writeFileSync(join(source, "styles/nested.css"), '.icon {background:url("./--icon.png");content:"REVISION"}');
		writeFileSync(join(source, "styles/other.css"), ".other {animation:pulse 1s}");
		writeFileSync(join(source, "styles/--icon.png"), Buffer.from([137, 80, 78, 71]));
		const artifact = await stageDesktopExtension(source, cache, "example");
		const css = artifact.styles.map((path) => readFileSync(join(artifact.root, path), "utf8")).join("\n");
		expect(css).toContain(`animation:kc-example-${artifact.revision}-pulse 1s`);
		expect(css).toContain('content:"REVISION"');
		expect(css).toContain(`/styles/--icon.png`);
		expect(artifact.files).toContain("styles/--icon.png");
	});
	it.each([
		'import x from "node:fs";',
		'import type {Stats} from "node:fs";',
		'import x from "../outside.ts";',
		'export const x = import("./label.tsx");',
		'const x = require("react");',
	])("rejects unsupported loading: %s", async (code) => {
		const { source, cache } = fixture();
		writeFileSync(join(source, "app.tsx"), code);
		await expect(stageDesktopExtension(source, cache, "example")).rejects.toThrow(/import|loading|outside/i);
	});
	for (const kind of ["module", "asset"])
		it(`rejects an outside-root ${kind} reached through a junction`, async ({ skip }) => {
			const { source, cache } = fixture();
			const outside = join(dirname(source), "outside");
			mkdirSync(outside);
			writeFileSync(join(outside, "other.ts"), "export default {};");
			writeFileSync(join(outside, "other.png"), "outside");
			try {
				symlinkSync(outside, join(source, "linked"), "junction");
			} catch {
				skip(true, "Directory junctions are unavailable");
			}
			if (kind === "module") writeFileSync(join(source, "app.tsx"), 'export { default } from "./linked/other.ts";');
			else writeFileSync(join(source, "app.css"), '.external-only { background: url("./linked/other.png"); }');
			await expect(stageDesktopExtension(source, cache, "example")).rejects.toThrow(/outside|escape/i);
		});

	it("stages a backend-only package with an inert frontend instead of inferring a source entry", async () => {
		const { source, cache } = fixture();
		writeFileSync(
			join(source, "package.json"),
			JSON.stringify({ knightcode: { desktop: { backend: "./server.ts" } } }),
		);
		writeFileSync(
			join(source, "server.ts"),
			'throw new Error("backend staging must not execute code"); export default {};',
		);
		const artifact = await stageDesktopExtension(source, cache, "example");
		expect(artifact.backend).toBe("__backend/server.ts");
		expect(artifact.kinds).toEqual(["backend"]);
		expect(readFileSync(join(artifact.root, artifact.frontend), "utf8")).not.toContain("app.js");
	});
});
