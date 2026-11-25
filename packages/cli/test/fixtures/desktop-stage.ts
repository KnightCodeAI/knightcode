/** Real Bun transpiler entry for Node-hosted Vitest; never imports or evaluates the authored extension. */
import { stageDesktopExtension } from "../../src/app-server/desktop-extensions/artifacts.ts";
console.log(
	JSON.stringify(await stageDesktopExtension(process.argv[2]!, process.argv[3]!, process.argv[4] ?? "example")),
);
