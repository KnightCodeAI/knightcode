/** Built-in message rendering uses the same ordered renderer registry as external packages. */
import { defineDesktopExtension, experimental_conversationServices } from "@knightcodeai/cli/desktop";
export default defineDesktopExtension((app) => {
	app.experimental_registerItemRenderer({
		id: "markdown",
		order: Number.MAX_SAFE_INTEGER,
		experimental_available: (context) => context.item?.type === "agentMessage",
		experimental_render: ({ context }) => {
			const { experimental_Markdown: Markdown } = experimental_conversationServices();
			return context.item?.type === "agentMessage" ? <Markdown text={context.item.text} /> : null;
		},
	});
});
