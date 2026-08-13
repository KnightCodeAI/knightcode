import { readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

// KnightCode's distribution differs from upstream knightcode's on purpose. knightcode publishes a
// bundled `dist/` and points `bin.knightcode` at `dist/bundle/cli.js`. KnightCode ships
// prebuilt per-platform binaries as optionalDependencies and a dependency-free
// launcher (`bin/knightcode`) that resolves and spawns the right one, so nothing
// is published from `dist/`. Source runs directly under Bun, so the package
// entrypoints resolve to `src/`.
interface KnightCodePackageJson {
	bin: { knightcode: string };
	main: string;
	exports: Record<string, string>;
	optionalDependencies: Record<string, string>;
}

const packageJson = JSON.parse(
	readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as KnightCodePackageJson;

describe("package distribution entrypoints", () => {
	test("ships the launcher shim and resolves library entrypoints to source", () => {
		expect(packageJson.bin.knightcode).toBe("./bin/knightcode");
		expect(packageJson.main).toBe("./src/index.ts");
		expect(packageJson.exports["."]).toBe("./src/index.ts");
		expect(packageJson.exports["./rpc-entry"]).toBe("./src/rpc-entry.ts");
	});

	test("declares a prebuilt binary for every supported platform", () => {
		for (const target of ["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]) {
			expect(packageJson.optionalDependencies[`@knightcodeai/cli-${target}`]).toBeDefined();
		}
	});
});
