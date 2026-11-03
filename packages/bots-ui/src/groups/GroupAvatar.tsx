// Group avatars: the owner's initial and up to three bot faces, on a diagonal, triangle or square.
import type { Bot } from "@knightcode/bots-protocol";
import { BotAvatar } from "../avatar/BotAvatar.tsx";
import { useResource } from "../state/store.ts";

/** The group header's stack: bots first, then a "+N" cell when they do not all fit. */
export function clusterCells(count: number): { bots: number; more: number } {
	if (count <= 4) return { bots: count, more: 0 };
	return { bots: 3, more: count - 3 };
}

/** Includes the owner in a group; larger groups keep a 2×2 cluster rather than shrinking the faces. */
export function GroupAvatar({ members, size }: { members: Bot[]; size: number }) {
	const { data: account } = useResource("account", (api) => api.getAccount({}));
	const initial = (account?.name?.trim() || account?.email?.trim() || "?").slice(0, 1).toUpperCase();
	const visible = members.slice(0, 3);
	const cells = visible.length + 1;
	const cell = size * (cells === 1 ? 1 : cells === 2 ? 0.64 : 0.56);
	return (
		<span
			className="kb-group-avatar"
			data-cells={cells}
			style={{ width: size, height: size, fontSize: cell * 0.36 }}
			aria-hidden
		>
			<span className="kb-group-avatar__cell kb-group-avatar__profile" style={{ width: cell, height: cell }}>
				{initial}
			</span>
			{visible.map((bot) => (
				<span key={bot.id} className="kb-group-avatar__cell">
					<BotAvatar bot={bot} state="idle" size={cell} isFollowingPointer={false} isInteractive={false} />
				</span>
			))}
		</span>
	);
}
