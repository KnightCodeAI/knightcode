/** Immutable backend bytes belong to the revision, not the renderer serving allowlist. */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { DesktopArtifact } from "../src/app-server/desktop-extensions/artifacts.ts";
import { prepareDesktopBackend } from "../src/app-server/desktop-extensions/backend.ts";

const roots: string[] = [];
function fixture(desktop: Record<string, unknown> = { frontend: "./app.js", backend: "./server.ts" }) {
	const root = mkdtempSync(join(tmpdir(), "kc-backend-artifacts-"));
	roots.push(root);
	const source = join(root, "source");
	mkdirSync(source);
	writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop } }));
	writeFileSync(join(source, "app.js"), "export default { apiVersion: 1, experimental_setup() {} };");
	writeFileSync(join(source, "schema.ts"), 'import { Type } from "typebox"; export const schema = Type.Number();');
	writeFileSync(
		join(source, "server.ts"),
		'import { readFileSync } from "node:fs"; import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend"; import { schema } from "./schema.ts"; throw new Error("staging must not execute backend source"); export default experimental_defineDesktopBackend(() => {});',
	);
	return { source, cache: join(root, "cache") };
}
function stage(source: string, cache: string): DesktopArtifact {
	return JSON.parse(
		execFileSync(
			"bun",
			[fileURLToPath(new URL("./fixtures/desktop-stage-revision.ts", import.meta.url)), source, cache],
			{ encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
		),
	);
}
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("backend revision artifacts", () => {
	it("hashes every local backend/schema byte without evaluating or publishing backend files", () => {
		const { source, cache } = fixture();
		const first = stage(source, cache);
		expect(first.backend).toBe("__backend/server.ts");
		expect(readFileSync(join(first.root, first.backend!), "utf8")).toContain("staging must not execute");
		expect(existsSync(join(first.root, "__backend/schema.ts"))).toBe(true);
		expect(first.files).toEqual(["app.js", "__entry.js"]);
		expect(stage(source, cache).revision).toBe(first.revision);
		writeFileSync(join(source, "schema.ts"), 'import { Type } from "typebox"; export const schema = Type.String();');
		const next = stage(source, cache);
		expect(next.revision).not.toBe(first.revision);
		expect(readFileSync(join(first.root, "__backend/schema.ts"), "utf8")).toContain("Type.Number");
		expect(readFileSync(join(next.root, "__backend/schema.ts"), "utf8")).toContain("Type.String");
	});
	it("captures a shared contract once for both graphs when the source changes between traversals", () => {
		const { source, cache } = fixture({ frontend: "./app.tsx", backend: "./server.ts" });
		writeFileSync(join(source, "schema.ts"), "export const value = 1;");
		writeFileSync(
			join(source, "app.tsx"),
			'import { value } from "./schema.ts"; export default { apiVersion: 1, experimental_setup() { return value; } };',
		);
		const artifact: DesktopArtifact = JSON.parse(
			execFileSync(
				"bun",
				[fileURLToPath(new URL("./fixtures/desktop-stage-snapshot.ts", import.meta.url)), source, cache],
				{ encoding: "utf8", windowsHide: true },
			),
		);
		expect(readFileSync(join(artifact.root, "__backend/schema.ts"), "utf8")).toMatch(/value\s*=\s*1/);
		expect(readFileSync(join(artifact.root, "schema.js"), "utf8")).toMatch(/value\s*=\s*1/);
	});

	it("loads the captured backend graph rather than a later edit at its development source", async () => {
		const { source, cache } = fixture();
		writeFileSync(
			join(source, "schema.ts"),
			'import { Type } from "typebox"; export const schema = Type.Number(); export const value = 1;',
		);
		writeFileSync(
			join(source, "server.ts"),
			'import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend"; import { Type } from "typebox"; import { schema, value } from "./schema.ts"; export default experimental_defineDesktopBackend(app => { app.experimental_registerRpc({ id:"value", kind:"read", params:Type.Object({}), result:schema, experimental_handle:() => value }); });',
		);
		const first = stage(source, cache);
		writeFileSync(
			join(source, "schema.ts"),
			'import { Type } from "typebox"; export const schema = Type.String(); export const value = "v2";',
		);
		const second = stage(source, cache);
		const old = await prepareDesktopBackend(join(first.root, first.backend!), "example", join(cache, "data"), () => {});
		await old.activate();
		expect(await old.call("value", {}, new AbortController().signal)).toBe(1);
		await old.dispose();
		const next = await prepareDesktopBackend(
			join(second.root, second.backend!),
			"example",
			join(cache, "data"),
			() => {},
		);
		await next.activate();
		expect(await next.call("value", {}, new AbortController().signal)).toBe("v2");
		await next.dispose();
	});
	it("accepts backend-only declarations without inferring or reading a frontend entry", () => {
		const { source, cache } = fixture({ backend: "./server.ts" });
		rmSync(join(source, "app.js"));
		const artifact = stage(source, cache);
		expect(artifact.backend).toBe("__backend/server.ts");
		expect(artifact.files).toEqual(["__entry.js"]);
		expect(readFileSync(join(artifact.root, artifact.frontend), "utf8")).toContain("experimental_setup");
	});
	it.each([
		'import x from "../outside.ts";',
		'import x from "unreviewed-package";',
		'const module = import("./schema.ts");',
		'const module = require("node:fs");',
	])("rejects backend graphs that cannot be captured immutably: %s", (code) => {
		const { source, cache } = fixture();
		writeFileSync(join(source, "server.ts"), code);
		expect(() => stage(source, cache)).toThrow(/import|loading|outside|artifact/i);
	});
	it("rejects importing the backend entry from the frontend graph", () => {
		const { source, cache } = fixture();
		writeFileSync(join(source, "app.js"), 'import "./server.ts"; export default {};');
		expect(() => stage(source, cache)).toThrow(/backend|frontend/i);
	});
	it("refuses a frontend import of the backend entry through an in-root directory junction", () => {
		const { source, cache } = fixture();
		writeFileSync(
			join(source, "server.ts"),
			'export default {apiVersion:1,experimental_setup(){}}; export const token="private";',
		);
		symlinkSync(source, join(source, "alias"), "junction");
		writeFileSync(join(source, "app.js"), 'import "./alias/server.ts"; export default {};');
		expect(() => stage(source, cache)).toThrow(/backend entry/i);
	});
	it.each(["__backend", "__BACKEND", "__backend.", "__backend "])(
		"reserves the private backend directory %s even for authored frontend assets",
		(directory) => {
			const { source, cache } = fixture({ frontend: `./${directory}/app.js` });
			mkdirSync(join(source, directory));
			writeFileSync(join(source, directory, "app.js"), "export default {};");
			expect(() => stage(source, cache)).toThrow(/reserved|backend/i);
		},
	);
	it.each([
		{ styles: [] },
		{ frontend: 1 },
		{ frontend: "" },
		{ backend: "" },
		{ backend: false },
		{ backend: "./server.ts", extra: true },
	])("rejects malformed explicit entries: %j", (manifest) => {
		const { source, cache } = fixture(manifest);
		expect(() => stage(source, cache)).toThrow();
	});
});
