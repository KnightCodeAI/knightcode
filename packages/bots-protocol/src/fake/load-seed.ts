// Reads a fake-backend seed from a JSON file. Node only, so the browser bundle never imports node:fs.
import { readFile } from "node:fs/promises";
import { type FakeSeed, seedFrom } from "./seed.ts";

/** Loads a seed file; fields it omits come from the default seed. */
export async function loadSeed(path: string): Promise<FakeSeed> {
	return seedFrom(JSON.parse(await readFile(path, "utf8")) as Partial<FakeSeed>);
}
