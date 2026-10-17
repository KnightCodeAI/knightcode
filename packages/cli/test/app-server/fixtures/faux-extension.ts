import { appendFileSync } from "node:fs";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@knightcode/ai";
import type { ExtensionAPI } from "../../../src/index.ts";

/**
 * Registers a faux provider so a spawned app server never reaches a real one, and records session_shutdown
 * in the file KC_TEST_SHUTDOWN_FILE names, so a test can see that shutdown reached the extensions.
 */
export default function fauxExtension(knightcode: ExtensionAPI): void {
	knightcode.on("session_shutdown", () => {
		const mark = process.env.KC_TEST_SHUTDOWN_FILE;
		if (mark) appendFileSync(mark, "session_shutdown\n");
	});
	const faux = fauxProvider({ provider: "faux-e2e", tokensPerSecond: 50 });
	faux.setResponses([
		fauxAssistantMessage([fauxText("hello from the app server")]),
		fauxAssistantMessage([fauxText("a long answer ".repeat(40))]),
	]);
	knightcode.registerProvider(faux.provider);
}
