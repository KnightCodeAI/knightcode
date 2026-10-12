import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "../../../src/index.ts";

export default async function noncooperative(knightcode: ExtensionAPI): Promise<void> {
	if (process.env.KC_TEST_HOLD_FACTORY === "1") {
		appendFileSync(process.env.KC_TEST_SHUTDOWN_FILE!, "factory_entered\n");
		await new Promise<void>(() => {});
	}
	knightcode.registerCommand("hold", {
		description: "Test cancellation-insensitive preflight",
		handler: async () => {
			appendFileSync(process.env.KC_TEST_SHUTDOWN_FILE!, "preflight_entered\n");
			await new Promise<void>(() => {});
		},
	});
}
