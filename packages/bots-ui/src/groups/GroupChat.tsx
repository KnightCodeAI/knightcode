// A group chat: 2 to 10 bots and the user share one conversation. @Name wakes a bot, @everyone wakes all; with no
// mention the lead answers and can bring others in. Each bot keeps its own memory and computer.
import type { Group } from "@knightcode/bots-protocol";
import { ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { BotAvatar, threadState } from "../avatar/BotAvatar.tsx";
import { Thread } from "../chat/ChatView.tsx";
import { navigate } from "../shell/routes.ts";
import { useBots, useConversation } from "../state/store.ts";
import { clusterCells } from "./GroupAvatar.tsx";
import { TurnIndicator } from "./TurnIndicator.tsx";

/** The middle column for one group. */
export function GroupChat({ group, paneOpen }: { group: Group; paneOpen: boolean }) {
	const target = useMemo(() => ({ groupId: group.id }), [group.id]);
	const view = useConversation(target);
	const { data } = useBots();
	const bots = useMemo(() => new Map((data?.bots ?? []).map((b) => [b.id, b])), [data]);
	const members = group.memberIds.map((id) => bots.get(id)).filter((b) => b !== undefined);
	const { bots: faces, more } = clusterCells(members.length);
	const cells = faces + (more ? 1 : 0);
	const avatarSize = cells === 1 ? 28 : cells === 2 ? 17 : 14;
	return (
		<>
			<header className="kb-toolbar" data-ref="toolbar">
				<div role="group" data-ref="chat-header" style={{ display: "flex", justifyContent: "center", minWidth: 0 }}>
					<span role="heading" aria-level={1} aria-label={group.name} style={{ display: "flex", minWidth: 0 }}>
						<button
							type="button"
							className="kb-identity kb-identity--details kb-identity--group"
							aria-label="View group details"
							aria-expanded={paneOpen}
							title={members.map((b) => b.name).join(", ")}
							onClick={() => navigate({ name: "group", groupId: group.id, pane: paneOpen ? "closed" : "details" })}
						>
							<span className="kb-group-avatar kb-identity__stack" data-cells={cells} data-avatar-box="">
								{members.slice(0, faces).map((bot) => (
									<span key={bot.id} className="kb-group-avatar__cell kb-identity__stack-item">
										<BotAvatar bot={bot} state={threadState(view, bot.id)} size={avatarSize} pointerArea=".kb-chat" />
									</span>
								))}
								{more > 0 && (
									<span className="kb-group-avatar__cell kb-group-avatar__more kb-identity__stack-item" aria-hidden>
										<span>+{more}</span>
									</span>
								)}
							</span>
							<span className="kb-identity__name">{group.name}</span>
							<span className="kb-identity__chevron" aria-hidden="true">
								<ChevronRight size={14} strokeWidth={2} />
							</span>
						</button>
					</span>
				</div>
			</header>
			<Thread
				key={group.id}
				target={target}
				view={view}
				name={group.name}
				below={<TurnIndicator view={view} bots={bots} />}
			/>
		</>
	);
}
