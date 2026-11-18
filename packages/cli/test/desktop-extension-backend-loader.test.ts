/** Desktop backends use the same jiti resolver as session extensions. */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { importExtensionDefault } from "../src/core/extensions/loader.ts";

const roots: string[] = [];
afterEach(() => {
	for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("loads a revision-local TypeScript backend and host TypeBox through jiti", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-backend-loader-"));
	roots.push(root);
	mkdirSync(join(root, "revision"));
	writeFileSync(join(root, "revision", "value.ts"), "export const value: number = 42;");
	const entry = join(root, "revision", "server.ts");
	writeFileSync(
		entry,
		'import { Type } from "typebox"; import { value } from "./value.ts"; export default { schema: Type.Number(), value };',
	);
	const result = await importExtensionDefault(entry);
	expect(result).toMatchObject({ schema: { type: "number" }, value: 42 });
});
