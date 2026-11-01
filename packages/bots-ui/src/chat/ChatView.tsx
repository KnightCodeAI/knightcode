// A bot's chat: the identity pill that toggles the details pane, the transcript, and the composer.
import type { Bot } from "@knightcode/bots-protocol";
import { useMemo } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots, useConversation, useStore } from "../state/store.ts";
import type { CardActions } from "./cards/CardView.tsx";
import { Composer } from "./Composer.tsx";
import { Transcript } from "./Transcript.tsx";

export interface ChatViewProps {
	bot: Bot;
	paneOpen: boolean;
}

/** The middle column for one bot. */
export function ChatView({ bot, paneOpen }: ChatViewProps) {
	const store = useStore();
	const target = useMemo(() => ({ botId: bot.id }), [bot.id]);
	const view = useConversation(target);
	const { data } = useBots();
	const bots = useMemo(() => new Map((data?.bots ?? []).map((b) => [b.id, b])), [data]);
	const actions: CardActions = {
		answer: (entryId, value) => store.socket.answer(target, entryId, value),
		connectApp: (appId) => navigate({ name: "connectors", appId }),
		openExchange: () => undefined,
	};
	return (
		<>
			<header className="kb-toolbar" data-ref="toolbar">
				<div role="group" data-ref="chat-header" style={{ display: "flex", justifyContent: "center" }}>
					<span role="heading" aria-level={1} aria-label={bot.name}>
						<button
							type="button"
							className="kb-identity"
							aria-label="View conversation details"
							aria-expanded={paneOpen}
							data-ref="header-identity"
							onClick={() => navigate({ name: "bot", botId: bot.id, pane: paneOpen ? "closed" : "details" })}
						>
							<span className="kb-identity__avatar" data-ref="header-avatar" data-avatar-box="">
								<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={24} />
							</span>
							<span className="kb-identity__name" data-ref="header-name">
								{bot.name}
							</span>
						</button>
					</span>
				</div>
			</header>
			<Transcript view={view} bots={bots} botName={bot.name} actions={actions} />
			<Composer
				placeholder={`Message ${bot.name}`}
				running={view?.running ?? false}
				onSend={(text) => store.socket.submit(target, text)}
				onStop={() => store.socket.stop(target)}
			/>
		</>
	);
}
