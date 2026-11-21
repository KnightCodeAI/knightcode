import { mkdirSync, mkdtempSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";
import { ExtensionArtifacts } from "../../src/main/extension-artifacts.ts";
const roots: string[] = [];
afterEach(() => {
	for (const path of roots.splice(0)) rmSync(path, { recursive: true, force: true });
});
test("only registered owner/revision files and supported MIME types are served", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-ext-serving-"));
	roots.push(root);
	writeFileSync(join(root, "app.js"), "export default {};");
	writeFileSync(join(root, "secret.txt"), "private");
	const server = new ExtensionArtifacts("app://desktop");
	server.register(
		{
			owner: "example",
			revision: "a".repeat(64),
			root,
			frontend: "app.js",
			styles: [],
			files: ["app.js"],
		},
		0,
		"initial",
	);
	const base = `app://ext/example/${"a".repeat(64)}`;
	const response = await server.serve(new Request(`${base}/app.js`));
	expect(await response.text()).toBe("export default {};");
	expect(response.headers.get("Content-Type")).toContain("javascript");
	expect(response.headers.get("Access-Control-Allow-Origin")).toBe("app://desktop");
	for (const url of [
		`${base}/secret.txt`,
		`${base}/%2e%2e%2fsecret.txt`,
		`app://ext/other/${"a".repeat(64)}/app.js`,
		`${base.replace(/a{64}/, "b".repeat(64))}/app.js`,
	])
		expect((await server.serve(new Request(url))).status).not.toBe(200);
	server.clear();
	expect((await server.serve(new Request(`${base}/app.js`))).status).toBe(404);
});
test.each(["__backend", "__BACKEND", "__backend.", "__backend "])(
	"private backend source cannot enter main serving leases through %s",
	(directory) => {
		const root = mkdtempSync(join(tmpdir(), "kc-ext-backend-serving-"));
		roots.push(root);
		const server = new ExtensionArtifacts("app://desktop");
		expect(() =>
			server.register(
				{
					owner: "example",
					revision: "a".repeat(64),
					root,
					frontend: "app.js",
					styles: [],
					files: ["app.js", `${directory}/server.js`],
				},
				1,
				"bad",
			),
		).toThrow(/backend|private/i);
	},
);

for (const replace of [false, true])
	test(`rejects a registered outside-root junction (replaced: ${replace})`, async ({ skip }) => {
		const parent = mkdtempSync(join(tmpdir(), "kc-ext-serving-junction-"));
		roots.push(parent);
		const root = join(parent, "artifact");
		const inside = join(root, "inside");
		const outside = join(parent, "outside");
		const linked = join(root, "linked");
		mkdirSync(inside, { recursive: true });
		mkdirSync(outside);
		writeFileSync(join(inside, "app.js"), "export default 'inside';");
		writeFileSync(join(outside, "app.js"), "export default 'outside';");
		try {
			symlinkSync(replace ? inside : outside, linked, "junction");
		} catch {
			skip(true, "Directory junctions are unavailable");
		}
		const server = new ExtensionArtifacts("app://desktop");
		const revision = "a".repeat(64);
		server.register(
			{ owner: "example", revision, root, frontend: "linked/app.js", styles: [], files: ["linked/app.js"] },
			1,
			"lease",
		);
		const request = new Request(`app://ext/example/${revision}/linked/app.js`);
		if (replace) {
			expect((await server.serve(request)).status).toBe(200);
			unlinkSync(linked);
			symlinkSync(outside, linked, "junction");
		}
		expect((await server.serve(request)).status).toBe(403);
	});

test("a physical backend file cannot be served through a public directory junction", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-ext-private-alias-"));
	roots.push(root);
	mkdirSync(join(root, "__backend"));
	writeFileSync(join(root, "__backend/server.js"), "export const secret = 1;");
	symlinkSync(join(root, "__backend"), join(root, "public"), "junction");
	const server = new ExtensionArtifacts("app://desktop");
	server.register(
		{
			owner: "example",
			revision: "a".repeat(64),
			root,
			frontend: "app.js",
			styles: [],
			files: ["public/server.js"],
		},
		1,
		"alias",
	);
	const response = await server.serve(new Request(`app://ext/example/${"a".repeat(64)}/public/server.js`));
	expect(response.status).toBe(403);
});

test("runtime shims name only validated host modules and exports", async () => {
	const server = new ExtensionArtifacts("app://desktop");
	server.runtime({ react: ["useState", "default"] });
	const shim = await server.serve(new Request("app://ext/runtime/react.js"));
	expect(await shim.text()).toContain("__knightcodeDesktopRuntime");
	expect((await server.serve(new Request("app://ext/runtime/node%3Afs.js"))).status).toBe(404);
	expect(() => server.runtime({ react: ["x;evil()"] })).toThrow();
});
test("an old lease cannot release a later acquisition of the same window and revision", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-ext-leases-"));
	roots.push(root);
	writeFileSync(join(root, "app.js"), "export default {};");
	const artifact = {
		owner: "example",
		revision: "a".repeat(64),
		root,
		frontend: "app.js",
		styles: [],
		files: ["app.js"],
	};
	const server = new ExtensionArtifacts("app://desktop");
	const request = new Request(`app://ext/example/${artifact.revision}/app.js`);
	server.register(artifact, 1, "old");
	server.register(artifact, 1, "new");
	server.release(1, artifact.owner, artifact.revision, "old");
	expect((await server.serve(request)).status).toBe(200);
	server.register(artifact, 2, "other");
	server.releaseWindow(1);
	expect((await server.serve(request)).status).toBe(200);
	server.release(2, artifact.owner, artifact.revision, "other");
	expect((await server.serve(request)).status).toBe(404);
});
