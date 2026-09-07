import type { ExtensionAPI, ExtensionCommandContext } from "@knightcodeai/cli";

export function remoteExtension(knightcode: ExtensionAPI): void {
	knightcode.registerCommand("remote", {
		description: "Publish this session to a live web link",
		handler: async (_args: string, ctx: ExtensionCommandContext): Promise<void> => {
			ctx.ui.notify("Remote sessions are not configured yet", "warning");
		},
	});
}
