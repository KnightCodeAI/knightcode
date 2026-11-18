/** Candidate staging proof under real Bun; no module evaluation or activation. */
import { stageDesktopRevision } from "../../src/app-server/desktop-extensions/artifacts.ts";
console.log(JSON.stringify(await stageDesktopRevision(process.argv[2]!, process.argv[3]!, "example")));
