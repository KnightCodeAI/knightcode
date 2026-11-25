/** Cache pruning preserves management, preparation, and native serving lifetimes. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { DesktopArtifactCache, retainDesktopArtifact } from "../src/app-server/desktop-extensions/artifact-cache.ts";

test("keeps bounded history while separate cache users retain old and pending revisions", async () => {
	const root = mkdtempSync(join(tmpdir(), "kc-artifact-retention-"));
	const source = join(root, "source");
	const cache = join(root, "cache");
	mkdirSync(source);
	writeFileSync(join(source, "package.json"), JSON.stringify({ knightcode: { desktop: { frontend: "app.js" } } }));
	const a = new DesktopArtifactCache(cache);
	const b = new DesktopArtifactCache(cache);
	const build = async (index: number) => {
		writeFileSync(
			join(source, "app.js"),
			`export default {apiVersion:1,experimental_setup(){ const revision=${index}; }};`,
		);
		const staged = await (index % 2 ? a : b).stage(source, "example");
		utimesSync(join(staged.artifact.root, ".staged"), index + 1, index + 1);
		return staged;
	};
	try {
		const first = await build(0);
		const serving = retainDesktopArtifact(first.artifact.root);
		first.lease.release();
		const pending = await build(1);
		for (let i = 2; i < 12; i++) (await build(i)).lease.release();
		expect(existsSync(first.artifact.root)).toBe(true);
		expect(existsSync(pending.artifact.root)).toBe(true);
		expect(
			readdirSync(join(cache, "example")).filter((name) => /^[a-f0-9]{64}$/.test(name)).length,
		).toBeLessThanOrEqual(6);
		serving.release();
		pending.lease.release();
		(await build(12)).lease.release();
		expect(existsSync(first.artifact.root)).toBe(false);
		expect(existsSync(pending.artifact.root)).toBe(false);
		expect(
			readdirSync(join(cache, "example")).filter((name) => /^[a-f0-9]{64}$/.test(name)).length,
		).toBeLessThanOrEqual(4);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
