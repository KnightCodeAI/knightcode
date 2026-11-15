/** Advertise the version-matched desktop guide only to desktop-client sessions. */
import { join } from "node:path";
import { getDocsPath } from "../config.ts";
import type { ExtensionAPI } from "../core/extensions/types.ts";

export default function desktopCustomization(knightcode: ExtensionAPI): void {
	knightcode.on("resources_discover", (_event, ctx) =>
		ctx.mode === "desktop" ? { skillPaths: [join(getDocsPath(), "desktop-customization", "SKILL.md")] } : undefined,
	);
}
