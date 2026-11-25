/** Render assistant messages and add a message action without owning transcript or clipboard state. */
import {
	defineDesktopExtension,
	experimental_conversationServices,
	experimental_Button as Button,
} from "@knightcodeai/cli/desktop";
export default defineDesktopExtension((app) => {
	app.experimental_registerItemRenderer({
		id: "reply",
		experimental_available: (context) => context.item?.type === "agentMessage",
		experimental_render: ({ context }) => {
			const { experimental_Markdown: Markdown } = experimental_conversationServices();
			return context.item?.type === "agentMessage" ? (
				<section className="external-reply">
					<div className="reply-caption">External reply</div>
					<Markdown text={context.item.text} />
				</section>
			) : null;
		},
	});
	app.experimental_registerMessageAction({
		id: "copy",
		experimental_available: (context) => context.item?.type === "agentMessage",
		experimental_render: ({ context }) => (
			<Button
				size="xs"
				onClick={() => {
					if (context.item?.type === "agentMessage")
						void experimental_conversationServices().experimental_copyText(context.item.text);
				}}
			>
				Copy external reply
			</Button>
		),
	});
});
