import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// npm and the installer ship an esbuild bundle (scripts/build-bundle.ts) that runs on the
// user's Node. The Bun-compiled binaries are GitHub release downloads only, so the package
// has no platform dependencies. Source runs directly under Bun, so the workspace entrypoints
// resolve to `src/`.
interface KnightCodePackageJson {
	bin: { knightcode: string };
	main: string;
	exports: Record<string, string>;
	files: string[];
	engines: { node: string };
	dependencies?: Record<string, string>;
	optionalDependencies?: Record<string, string>;
}

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as KnightCodePackageJson;

describe("package distribution entrypoints", () => {
	test("runs the Node bundle and resolves library entrypoints to source", () => {
		expect(packageJson.bin.knightcode).toBe("./dist/bundle/cli.js");
		expect(packageJson.files).toContain("dist/");
		expect(packageJson.main).toBe("./src/index.ts");
		expect(packageJson.exports["."]).toBe("./src/index.ts");
		expect(packageJson.exports["./rpc-entry"]).toBe("./src/rpc-entry.ts");
	});

	test("installs no platform binaries", () => {
		expect(packageJson.optionalDependencies).toBeUndefined();
	});

	test("needs a Node with node:sqlite unflagged", () => {
		expect(packageJson.engines.node).toBe(">=22.19.0");
	});

	test("depends only on what the bundle leaves external", () => {
		expect(Object.keys(packageJson.dependencies ?? {}).sort()).toEqual([
			"@silvia-odwyer/photon-node",
			"jiti",
			"quickjs-wasi",
		]);
	});
});
