/** One contribution registry per renderer window; no store or native services live here. */
import { ExtensionRegistry } from "./registry.ts";

export const desktopExtensions = new ExtensionRegistry();
