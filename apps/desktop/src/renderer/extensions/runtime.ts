/** One contribution registry per renderer window; no store or native services live here. */
import { ExtensionRegistry } from "./registry.ts";

import { reportExternal } from "./external.ts";

export const desktopExtensions = new ExtensionRegistry((owner, error, revision) => {
	console.error(owner, error);
	if (!owner.startsWith("builtin."))
		reportExternal(owner, revision ?? "unknown", "render", error instanceof Error ? error.message : String(error));
});
