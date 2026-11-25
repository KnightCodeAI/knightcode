/** Test-only consent fixture: never exposed as a CLI command or shipped authoring permission. */
import { DesktopExtensionManager } from "../../src/app-server/desktop-extensions/manager.ts";
const [agent, source] = process.argv.slice(2);
const manager = new DesktopExtensionManager(agent!);
const entry = (await manager.list()).extensions.find(entry => entry.source === source);
if (!entry) throw new Error("Fixture source was not discovered.");
const reviewed = (await manager.list(undefined, entry.owner)).extensions.find((item) => item.owner === entry.owner);
await manager.set({ owner: entry.owner, source: entry.source, approve: true, kinds: reviewed?.kinds, revision: reviewed?.revision, dev: true });
