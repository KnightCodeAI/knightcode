import { join } from "node:path";
import { expect, test } from "vitest";
import { rendererPath } from "../../src/main/protocol-scheme.ts";

const DIR = join("/opt", "knightcode", "renderer");
const serve = (url: string) => rendererPath(DIR, new URL(url).pathname);

test("app:// serves files inside the renderer directory", () => {
	expect(serve("app://desktop/index.html")).toBe(join(DIR, "index.html"));
	expect(serve("app://desktop/assets/a%20b.js")).toBe(join(DIR, "assets", "a b.js"));
});

test("app:// refuses paths that leave the renderer directory", () => {
	// The URL parser resolves plain and %2e dot segments; encoded separators survive it and are decoded here.
	expect(serve("app://desktop/../../etc/passwd")).toBe(join(DIR, "etc", "passwd"));
	expect(serve("app://desktop/..%2f..%2fetc%2fpasswd")).toBe(403);
	expect(serve("app://desktop/assets/..%2f..%2f..%2fsecret")).toBe(403);
	// A separator on Windows, part of one `..`-led file name on POSIX: refused either way.
	expect(serve("app://desktop/..%5c..%5csecret")).toBe(403);
});

test("app:// answers a malformed escape with 400", () => {
	expect(serve("app://desktop/%E0%A4%A")).toBe(400);
});
