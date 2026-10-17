import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, test } from "vitest";
import { readAtMost, readImageInput } from "../../src/app-server/image-input.ts";

const dir = mkdtempSync(join(tmpdir(), "knightcode-image-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
// A 1x1 PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==",
	"base64",
);

test("a path to a PNG becomes the same image as its base64 form", async () => {
	const file = join(dir, "a.png");
	writeFileSync(file, PNG);
	expect(await readImageInput({ path: file })).toEqual({ mimeType: "image/png", data: PNG.toString("base64") });
	expect(await readImageInput({ mimeType: "image/png", data: "AA==" })).toEqual({
		mimeType: "image/png",
		data: "AA==",
	});
});

test("directories, non-images, missing, relative and oversized paths are refused as invalidParams", async () => {
	mkdirSync(join(dir, "d"));
	writeFileSync(join(dir, "t.txt"), "not an image");
	writeFileSync(join(dir, "big.png"), Buffer.concat([PNG, Buffer.alloc(20 * 1024 * 1024)]));
	for (const path of [join(dir, "d"), join(dir, "t.txt"), join(dir, "missing.png"), "a.png", join(dir, "big.png")]) {
		await expect(readImageInput({ path })).rejects.toMatchObject({ code: "invalidParams" });
	}
});

// Creating symlinks on Windows needs a privilege CI does not have.
test.skipIf(process.platform === "win32")(
	"a symlink to an oversized file is refused by the target's size",
	async () => {
		const target = join(dir, "huge.png");
		writeFileSync(target, Buffer.concat([PNG, Buffer.alloc(21 * 1024 * 1024)]));
		const link = join(dir, "link.png");
		symlinkSync(target, link);
		await expect(readImageInput({ path: link })).rejects.toMatchObject({ code: "invalidParams" });
	},
);

test("readAtMost keeps reading after short reads and stops one byte past the limit", async () => {
	const source = Buffer.from("0123456789");
	const shortReads = {
		read: async (buffer: Buffer, offset: number, length: number, position: number) => {
			const n = Math.min(3, length, source.length - position); // never more than 3 bytes per call
			if (n <= 0) return { bytesRead: 0 };
			source.copy(buffer, offset, position, position + n);
			return { bytesRead: n };
		},
	};
	expect((await readAtMost(shortReads, 100)).toString()).toBe("0123456789");
	expect((await readAtMost(shortReads, 4)).length).toBe(5);
});
