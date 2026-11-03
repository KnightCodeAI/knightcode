// A group's details pane, with its shared files and directly editable membership.
import type { Group } from "@knightcode/bots-protocol";
import { Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { BotAvatar } from "../avatar/BotAvatar.tsx";
import { FileList } from "../chat/FilePreview.tsx";
import { IconButton } from "../primitives/IconButton.tsx";
import { Popover } from "../primitives/Popover.tsx";
import { Select } from "../primitives/Select.tsx";
import { Tabs } from "../primitives/Tabs.tsx";
import { type GroupPaneView, navigate } from "../shell/routes.ts";
import { BOTS, type BotList, useBots, useConversation, useStore } from "../state/store.ts";
import { GroupAvatar } from "./GroupAvatar.tsx";
import { MAX_MEMBERS, MIN_MEMBERS } from "./CreateGroup.tsx";

type GroupPatch = Partial<Pick<Group, "name" | "leadId" | "turnBudget" | "memberIds">>;

/** Keeps the group conversation visible while browsing details, shared files or members. */
export function GroupPane({ group, view }: { group: Group; view: GroupPaneView | "closed" }) {
	const { data } = useBots();
	const closed = view === "closed";
	const members = group.memberIds.flatMap((id) => data?.bots.find((bot) => bot.id === id) ?? []);
	return (
		<aside
			className="kb-pane"
			aria-label="Group details"
			data-ref="info-pane"
			data-closed={closed ? "" : undefined}
			aria-hidden={closed}
			inert={closed}
		>
			<header className="kb-pane__top" data-ref="info-pane-top">
				<IconButton
					label="Close"
					icon={<X size={16} strokeWidth={1.75} />}
					onClick={() => navigate({ name: "group", groupId: group.id, pane: "closed" })}
				/>
			</header>
			<div className="kb-pane__scroll">
				<div className="kb-pane__head">
					<GroupAvatar members={members} size={64} />
					<GroupName group={group} />
				</div>
				<div className="kb-pane__tabs">
					<Tabs
						label="Group details"
						value={closed ? "details" : view}
						onValueChange={(pane) => navigate({ name: "group", groupId: group.id, pane: pane as GroupPaneView })}
						listClassName="kb-pane__tablist"
						items={[
							{ value: "details", label: "Details" },
							{ value: "library", label: "Library" },
							{ value: "members", label: "Members" },
						]}
					/>
				</div>
				<div className="kb-pane__panel" role="tabpanel" aria-label={view}>
					{view === "details" && <GroupDetails group={group} />}
					{view === "library" && <GroupLibrary group={group} />}
					{view === "members" && <GroupMembers group={group} />}
				</div>
			</div>
		</aside>
	);
}

function GroupName({ group }: { group: Group }) {
	const [name, setName] = useState(group.name);
	const { update, saving, error } = useGroupUpdate(group);
	useEffect(() => setName(group.name), [group.name]);
	const save = () => {
		const trimmed = name.trim();
		if (!trimmed || trimmed === group.name) return setName(group.name);
		void update({ name: trimmed });
	};
	return (
		<>
			<input
				className="kb-pane__name"
				aria-label="Group name"
				value={name}
				disabled={saving}
				onChange={(event) => setName(event.target.value)}
				onBlur={save}
				onKeyDown={(event) => {
					if (event.key === "Enter") event.currentTarget.blur();
					if (event.key === "Escape") setName(group.name);
				}}
			/>
			{error && (
				<p className="kb-create__error" role="alert">
					{error}
				</p>
			)}
		</>
	);
}

function GroupDetails({ group }: { group: Group }) {
	const { data } = useBots();
	const { update, saving, error } = useGroupUpdate(group);
	const members = group.memberIds.map((id) => ({
		value: id,
		label: data?.bots.find((bot) => bot.id === id)?.name ?? id,
	}));
	return (
		<div className="kb-pane__stack">
			<section className="kb-group">
				<div className="kb-group__title">Conversation</div>
				<ul className="kb-group__list">
					<li className="kb-group__row">
						<span>Lead</span>
						<Select
							label="Lead"
							value={group.leadId}
							disabled={saving}
							onValueChange={(leadId) => void update({ leadId })}
							options={members}
						/>
					</li>
					<li className="kb-group__row">
						<span>Turns per message</span>
						<Select
							label="Turns per message"
							value={String(group.turnBudget)}
							disabled={saving}
							onValueChange={(value) => void update({ turnBudget: Number(value) })}
							options={[...new Set([3, 6, 10, 20, group.turnBudget])]
								.sort((a, b) => a - b)
								.map((value) => ({ value: String(value), label: String(value) }))}
						/>
					</li>
				</ul>
				<p className="kb-settings__hint">
					The lead answers when no one is mentioned and can bring others in. After the turn limit, bots are asked to
					wrap up.
				</p>
			</section>
			{error && (
				<p className="kb-create__error" role="alert">
					{error}
				</p>
			)}
		</div>
	);
}

function GroupLibrary({ group }: { group: Group }) {
	const target = useMemo(() => ({ groupId: group.id }), [group.id]);
	const view = useConversation(target);
	const files = [
		...new Map(
			(view?.entries ?? []).flatMap((entry) =>
				entry.kind === "message" ? (entry.attachments ?? []).map((file) => [file.id, file] as const) : [],
			),
		).values(),
	];
	return (
		<>
			{files.length > 0 ? (
				<FileList files={files} />
			) : (
				<p className="kb-pane__empty">Files shared in this conversation show up here</p>
			)}
			{view?.hasEarlier && <p className="kb-pane__empty">Only files from recent messages are shown.</p>}
		</>
	);
}

function GroupMembers({ group }: { group: Group }) {
	const { update, saving, error } = useGroupUpdate(group);
	const { data } = useBots();
	const [open, setOpen] = useState(false);
	const [query, setQuery] = useState("");
	const bots = data?.bots ?? [];
	const members = group.memberIds.flatMap((id) => bots.find((bot) => bot.id === id) ?? []);
	const available = bots.filter((bot) => !bot.archived && !group.memberIds.includes(bot.id));
	const matches = available.filter((bot) => bot.name.toLowerCase().includes(query.trim().toLowerCase()));
	const setMembers = async (memberIds: string[]) => {
		if (await update({ memberIds, leadId: memberIds.includes(group.leadId) ? group.leadId : memberIds[0]! }))
			setOpen(false);
	};
	return (
		<section className="kb-group-members" aria-label="Members" aria-busy={saving}>
			<ul className="kb-group-members__list">
				{members.map((bot) => (
					<li key={bot.id} className="kb-group-members__row">
						<button
							type="button"
							className="kb-group-members__bot"
							aria-label={`Open ${bot.name}`}
							onClick={() => navigate({ name: "bot", botId: bot.id, pane: "details" })}
						>
							<BotAvatar bot={bot} size={28} pointerArea=".kb-group-members__row" />
							<span>{bot.name}</span>
						</button>
						<button
							type="button"
							className="kb-group-members__remove"
							aria-label={`Remove ${bot.name}`}
							title={
								group.memberIds.length <= MIN_MEMBERS
									? `A group needs at least ${MIN_MEMBERS} bots`
									: `Remove ${bot.name}`
							}
							disabled={saving || group.memberIds.length <= MIN_MEMBERS}
							onClick={() => void setMembers(group.memberIds.filter((id) => id !== bot.id))}
						>
							Remove
						</button>
					</li>
				))}
			</ul>
			{group.memberIds.length >= MAX_MEMBERS ? (
				<p className="kb-group-members__hint">A group holds at most {MAX_MEMBERS} bots.</p>
			) : available.length === 0 ? (
				<p className="kb-group-members__hint">Create more Bots to add them here</p>
			) : (
				<Popover
					label="Add member"
					className="kb-member-picker"
					open={open}
					onOpenChange={(next) => {
						setOpen(next);
						if (next) setQuery("");
					}}
					trigger={
						<button type="button" className="kb-group-members__add" disabled={saving}>
							<Plus size={16} /> Add Member
						</button>
					}
				>
					<input
						className="kb-member-picker__search"
						aria-label="Search Bots"
						placeholder="Search Bots"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
					/>
					<div className="kb-member-picker__results">
						{matches.map((bot) => (
							<button
								key={bot.id}
								type="button"
								className="kb-group-members__bot"
								disabled={saving}
								onClick={() => void setMembers([...group.memberIds, bot.id])}
							>
								<BotAvatar bot={bot} size={28} pointerArea=".kb-group-members__bot" />
								<span>{bot.name}</span>
							</button>
						))}
						{matches.length === 0 && <p className="kb-group-members__hint">No bots found</p>}
					</div>
				</Popover>
			)}
			<p className="kb-group-members__hint">
				A group holds 2 to 10 bots and you. Each bot keeps its own memory and computer; only the conversation is shared.
			</p>
			{error && (
				<p className="kb-create__error" role="alert">
					{error}
				</p>
			)}
		</section>
	);
}

function useGroupUpdate(group: Group) {
	const store = useStore();
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const update = async (patch: GroupPatch): Promise<boolean> => {
		setSaving(true);
		setError(undefined);
		try {
			const next = await store.api.updateGroup({ groupId: group.id, ...patch });
			store.set<BotList>(
				BOTS,
				(list) => list && { ...list, groups: list.groups.map((g) => (g.id === next.id ? next : g)) },
			);
			return true;
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not update the group. Try again.");
			return false;
		} finally {
			setSaving(false);
		}
	};
	return { update, saving, error };
}
