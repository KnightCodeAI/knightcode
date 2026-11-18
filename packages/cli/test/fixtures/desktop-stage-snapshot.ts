/** Mutate a shared contract exactly between backend capture and frontend import traversal. */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { stageDesktopRevision } from "../../src/app-server/desktop-extensions/artifacts.ts";
const source = process.argv[2]!;
// This fixture runs only under Bun; describe the compiler method it intercepts without adding Bun to root types.
const runtime = globalThis as typeof globalThis & { Bun: { Transpiler: { prototype: { transformSync(code: string): string } } } };
const transform = runtime.Bun.Transpiler.prototype.transformSync;
let changed = false;
runtime.Bun.Transpiler.prototype.transformSync = function (code) {
 if (!changed) { changed = true; writeFileSync(join(source, "schema.ts"), "export const value = 2;"); }
 return transform.call(this, code);
};
console.log(JSON.stringify(await stageDesktopRevision(source, process.argv[3]!, "example")));
