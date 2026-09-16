import type { ExtensionAPI } from "@knightcodeai/cli";
import { Type } from "typebox";

export const seenAtSessionStart: string[][] = [];

export function probeExtension(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "probe",
		label: "Probe",
		description: "test only",
		parameters: Type.Object({}),
		async execute() {
			return { content: [{ type: "text", text: "probe" }], details: undefined };
		},
	});
	pi.on("session_start", () => {
		seenAtSessionStart.push(pi.getActiveTools());
	});
}
