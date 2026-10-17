import type { ExtensionAPI } from "../../../src/index.ts";

export const seenModes: string[] = [];
export const shutdowns: string[] = [];
export const replaceState = { cancelSwitch: false, switchTarget: "" };

export default function replaceExtension(knightcode: ExtensionAPI): void {
	knightcode.on("session_start", (_event, ctx) => {
		seenModes.push(ctx.mode);
	});
	knightcode.on("session_shutdown", (event) => {
		shutdowns.push(event.reason);
	});
	knightcode.on("session_before_switch", () => (replaceState.cancelSwitch ? { cancel: true } : undefined));
	knightcode.registerCommand("fresh", {
		description: "Start a fresh session",
		handler: async (_args, ctx) => {
			await ctx.newSession();
		},
	});
	knightcode.registerCommand("goto", {
		description: "Switch to another session file",
		handler: async (_args, ctx) => {
			await ctx.switchSession(replaceState.switchTarget);
		},
	});
	knightcode.registerCommand("note", {
		description: "Send an extension message",
		handler: async () => {
			knightcode.sendMessage({ customType: "note", content: "noted", display: true }, { triggerTurn: true });
		},
	});
}
