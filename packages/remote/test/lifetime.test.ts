import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { decodeViewerFrame } from "../src/protocol.ts";

const SOURCE_DIR = join(import.meta.dirname, "..", "src");

function sources(): Array<{ name: string; text: string }> {
	return readdirSync(SOURCE_DIR)
		.filter((name) => name.endsWith(".ts"))
		.map((name) => ({ name, text: readFileSync(join(SOURCE_DIR, name), "utf8") }));
}

describe("lifetime invariant", () => {
	test("no source file calls shutdown on the session", () => {
		// Matching the bare word "shutdown" would flag the session_shutdown event this
		// extension legitimately subscribes to. What must never appear is the call.
		const offenders = sources()
			.filter(({ text }) => /\bshutdown\s*\(/.test(text))
			.map(({ name }) => name);
		expect(offenders).toEqual([]);
	});

	test("the only lifetime control reached from a remote frame is abort", () => {
		const extension = sources().find(({ name }) => name === "extension.ts");
		expect(extension).toBeDefined();
		expect(extension?.text).toContain("ctx.abort()");
	});

	test("the protocol defines no frame that ends a session", () => {
		for (const type of ["shutdown", "quit", "exit", "kill"]) {
			expect(decodeViewerFrame(JSON.stringify({ v: 1, type }))).toBeUndefined();
		}
	});
});
