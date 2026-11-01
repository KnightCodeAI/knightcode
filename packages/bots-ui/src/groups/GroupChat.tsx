// A group chat: 2 to 10 bots and the user share one conversation. @Name wakes a bot, @everyone wakes all; with no
// mention the lead answers and can bring others in. Each bot keeps its own memory and computer.
import type { Group } from "@knightcode/bots-protocol";
import { useMemo } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { Thread } from "../chat/ChatView.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots, useConversation } from "../state/store.ts";
import { TurnIndicator } from "./TurnIndicator.tsx";

/** The middle column for one group. */
export function GroupChat({ group }: { group: Group }) {
	const target = useMemo(() => ({ groupId: group.id }), [group.id]);
	const view = useConversation(target);
	const { data } = useBots();
	const bots = useMemo(() => new Map((data?.bots ?? []).map((b) => [b.id, b])), [data]);
	const members = group.memberIds.map((id) => bots.get(id)).filter((b) => b !== undefined);
	return (
		<>
			<header className="kb-toolbar" data-ref="toolbar">
				<div role="group" data-ref="chat-header" style={{ display: "flex", justifyContent: "center" }}>
					<span role="heading" aria-level={1} aria-label={group.name}>
						<button
							type="button"
							className="kb-identity"
							aria-label="Group settings"
							onClick={() => navigate({ name: "group", groupId: group.id, settings: true })}
						>
							<span className="kb-identity__stack" data-avatar-box="">
								{members.slice(0, 3).map((bot) => (
									<span key={bot.id} className="kb-identity__stack-item">
										<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={20} />
									</span>
								))}
							</span>
							<span className="kb-identity__name">{group.name}</span>
							<span className="kb-identity__count">{members.length} bots</span>
						</button>
					</span>
				</div>
			</header>
			<Thread target={target} view={view} name={group.name} below={<TurnIndicator view={view} bots={bots} />} />
		</>
	);
}
