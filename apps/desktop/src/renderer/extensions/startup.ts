/** Window startup hints are initialized synchronously, before built-ins and first paint. */
import { StartupLayout } from "./startup-layout.ts";

let storage: Storage | undefined;
try {
	storage = window.localStorage;
} catch {
	/* Storage is optional for startup. */
}
export const startupLayout = new StartupLayout(storage, window.knightcode?.safeMode === true);
