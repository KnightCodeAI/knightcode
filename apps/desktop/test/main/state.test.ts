import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { StateFile } from "../../src/main/state.ts";
import { DEFAULT_STATE } from "../../src/shared/host-protocol.ts";

test("a corrupt state file is set aside and defaults apply; writes round-trip", () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-state-"));
	writeFileSync(join(dir, "desktop-state.json"), "{ not json");
	const file = new StateFile(dir);
	expect(file.read()).toEqual(DEFAULT_STATE);
	expect(readdirSync(dir).some((name) => name.startsWith("desktop-state.corrupt-"))).toBe(true);
	const next = { ...DEFAULT_STATE, projects: [{ path: "/p", collapsed: false }] };
	file.write(next);
	expect(JSON.parse(readFileSync(join(dir, "desktop-state.json"), "utf8"))).toEqual(next);
	expect(file.read()).toEqual(next);
	expect(readdirSync(dir).some((name) => name.endsWith(".tmp"))).toBe(false);
});

test("a state file that fails the schema is also set aside", () => {
	const dir = mkdtempSync(join(tmpdir(), "kc-state-"));
	writeFileSync(join(dir, "desktop-state.json"), JSON.stringify({ version: 2 }));
	expect(new StateFile(dir).read()).toEqual(DEFAULT_STATE);
});
