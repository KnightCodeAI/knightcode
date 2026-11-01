// A group's settings, or a new group: name, members (2 to 10 bots), the lead who answers when no one is mentioned,
// the turn budget, and delete.
import type { Group } from "@knightcode/bots-protocol";
import { useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { BOTS, useBots, useStore } from "../state/store.ts";

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 10;

/** Problems with a member list, in words; undefined when it is fine. */
export function membersProblem(memberIds: string[], leadId: string): string | undefined {
	if (memberIds.length < MIN_MEMBERS) return `Choose at least ${MIN_MEMBERS} bots.`;
	if (memberIds.length > MAX_MEMBERS) return `A group holds at most ${MAX_MEMBERS} bots.`;
	if (!memberIds.includes(leadId)) return "The lead must be a member.";
	return undefined;
}

/** `group` undefined creates one (?with=<botId> starts with that bot ticked). */
export function GroupSettings({ group, onClose }: { group?: Group; onClose: () => void }) {
	const store = useStore();
	const { data } = useBots();
	const start = useQueryParam("with");
	const bots = (data?.bots ?? []).filter((b) => !b.archived);
	const [name, setName] = useState(group?.name ?? "");
	const [memberIds, setMemberIds] = useState<string[]>(group?.memberIds ?? (start ? [start] : []));
	const [leadId, setLeadId] = useState(group?.leadId ?? start ?? "");
	const [turnBudget, setTurnBudget] = useState(String(group?.turnBudget ?? 6));
	const lead = memberIds.includes(leadId) ? leadId : (memberIds[0] ?? "");
	const problem = membersProblem(memberIds, lead);
	const save = async () => {
		const fields = { name: name.trim(), memberIds, leadId: lead };
		const saved = group
			? await store.api.updateGroup({ groupId: group.id, ...fields, turnBudget: Number(turnBudget) })
			: await store.api.createGroup(fields);
		store.reload(BOTS);
		navigate({ name: "group", groupId: saved.id, settings: false });
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={group ? `${group.name} settings` : "New group"}
			width={520}
			footer={
				<>
					{group && (
						<Button
							variant="secondary"
							onClick={() =>
								void store.api.deleteGroup({ groupId: group.id }).then(() => {
									store.reload(BOTS);
									navigate("/");
								})
							}
						>
							Delete group
						</Button>
					)}
					<span className="kb-create__spacer" />
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!name.trim() || problem !== undefined} onClick={() => void save()}>
						{group ? "Save" : "Create group"}
					</Button>
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<Input
					aria-label="Group name"
					placeholder="Group name"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				<fieldset className="kb-grant">
					<legend className="kb-settings__label">Members</legend>
					<p className="kb-settings__hint">
						A group holds 2 to 10 bots and you. Each bot keeps its own memory and computer; only the conversation is
						shared.
					</p>
					{bots.map((bot) => (
						<label key={bot.id} className="kb-recipe__check kb-member">
							<input
								type="checkbox"
								checked={memberIds.includes(bot.id)}
								onChange={(e) =>
									setMemberIds((list) => (e.target.checked ? [...list, bot.id] : list.filter((id) => id !== bot.id)))
								}
							/>
							<span className="kb-member__avatar" data-avatar-box="">
								<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={20} />
							</span>
							<span>
								{bot.name}
								<span className="kb-list__meta"> · {bot.purpose}</span>
							</span>
						</label>
					))}
					{problem && memberIds.length > 0 && (
						<p className="kb-create__error" role="alert">
							{problem}
						</p>
					)}
				</fieldset>
				{memberIds.length > 0 && (
					<div className="kb-settings__row kb-settings__row--start">
						<span>Lead</span>
						<Select
							label="Lead"
							value={lead}
							onValueChange={setLeadId}
							options={memberIds.map((id) => ({ value: id, label: bots.find((b) => b.id === id)?.name ?? id }))}
						/>
						<span className="kb-settings__hint">Answers when no one is mentioned, and can bring others in.</span>
					</div>
				)}
				{group && (
					<div className="kb-settings__row kb-settings__row--start">
						<span>Turns per message</span>
						<Select
							label="Turns per message"
							value={turnBudget}
							onValueChange={setTurnBudget}
							options={["3", "6", "10", "20"].map((v) => ({ value: v, label: v }))}
						/>
						<span className="kb-settings__hint">Past this, the bots are asked to wrap up.</span>
					</div>
				)}
			</div>
		</Dialog>
	);
}
