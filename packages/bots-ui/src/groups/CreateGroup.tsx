// Create a group inline by choosing recipients, then pressing Enter.
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { BotAvatar } from "../avatar/BotAvatar.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { BOTS, type BotList, useBots, useStore } from "../state/store.ts";

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 10;

/** Problems with a member list, in words; undefined when it is fine. */
export function membersProblem(memberIds: string[], leadId: string): string | undefined {
	if (memberIds.length < MIN_MEMBERS) return `Choose at least ${MIN_MEMBERS} bots.`;
	if (memberIds.length > MAX_MEMBERS) return `A group holds at most ${MAX_MEMBERS} bots.`;
	if (!memberIds.includes(leadId)) return "The lead must be a member.";
	return undefined;
}

/** Creates a group named after its recipients; ?with=<botId> preselects that bot. */
export function CreateGroup({ onClose }: { onClose: () => void }) {
	const store = useStore();
	const { data, loading, error: loadError } = useBots();
	const start = useQueryParam("with");
	const [memberIds, setMemberIds] = useState<string[]>(start ? [start] : []);
	const [query, setQuery] = useState("");
	const [active, setActive] = useState<number | null>(null);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string>();
	const input = useRef<HTMLInputElement>(null);
	const pending = useRef(false);
	const resultsId = useId();
	const bots = (data?.bots ?? []).filter((bot) => !bot.archived);
	const members = memberIds.map((id) => bots.find((bot) => bot.id === id)).filter((bot) => bot !== undefined);
	const needle = query.trim().toLocaleLowerCase();
	const choices = bots.filter((bot) => !memberIds.includes(bot.id) && bot.name.toLocaleLowerCase().includes(needle));
	const full = members.length >= MAX_MEMBERS;
	const highlighted = active === null ? undefined : choices[active];

	useEffect(() => {
		// A menu or command palette may restore focus as it closes; focus the new field after that restoration.
		const frame = requestAnimationFrame(() => input.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);
	useEffect(() => {
		if (highlighted) document.getElementById(`${resultsId}-option-${active}`)?.scrollIntoView({ block: "nearest" });
	}, [highlighted, resultsId, active]);

	const select = (id: string) => {
		if (full || pending.current) return;
		setMemberIds((list) => [...list, id]);
		setQuery("");
		setActive(null);
		setError(undefined);
		input.current?.focus();
	};
	const remove = (id: string) => {
		if (pending.current) return;
		setMemberIds((list) => list.filter((memberId) => memberId !== id));
		setActive(null);
		setError(undefined);
		input.current?.focus();
	};
	const save = async () => {
		if (pending.current) return;
		const ids = members.map((bot) => bot.id);
		const leadId = ids[0] ?? "";
		const problem = membersProblem(ids, leadId);
		if (problem) {
			setError(problem);
			return;
		}
		pending.current = true;
		setSaving(true);
		setError(undefined);
		try {
			const name = new Intl.ListFormat("en", { style: "long", type: "conjunction" }).format(
				members.map((bot) => bot.name),
			);
			const saved = await store.api.createGroup({ name, memberIds: ids, leadId });
			// Publish the response before navigating, rather than waiting for the sidebar reload or socket event.
			store.set<BotList>(
				BOTS,
				(list) => list && { ...list, groups: [...list.groups.filter((group) => group.id !== saved.id), saved] },
			);
			store.reload(BOTS);
			navigate({ name: "group", groupId: saved.id });
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not create group chat. Try again.");
			pending.current = false;
			setSaving(false);
			input.current?.focus();
		}
	};
	const submit = () => {
		if (highlighted || needle) {
			const choice = highlighted ?? choices[0];
			if (choice) select(choice.id);
		} else {
			void save();
		}
	};

	return (
		<form
			className="kb-group-create"
			aria-label="New group chat"
			aria-busy={saving}
			onSubmit={(event) => {
				event.preventDefault();
				submit();
			}}
			onKeyDown={(event) => {
				if (event.key === "Escape" && !event.nativeEvent.isComposing && !saving) {
					event.preventDefault();
					onClose();
				}
			}}
		>
			<header className="kb-group-create__to">
				<label htmlFor={`${resultsId}-input`}>To:</label>
				<div className="kb-group-create__recipients">
					{members.map((bot) => (
						<span key={bot.id} className="kb-group-create__chip">
							<BotAvatar bot={bot} size={16} pointerArea=".kb-group-create__chip" />
							<span className="kb-group-create__name">{bot.name}</span>
							<button type="button" aria-label={`Remove ${bot.name}`} disabled={saving} onClick={() => remove(bot.id)}>
								<X size={12} aria-hidden="true" />
							</button>
						</span>
					))}
					<input
						ref={input}
						id={`${resultsId}-input`}
						className="kb-group-create__input"
						role="combobox"
						aria-label="Start a chat with"
						aria-autocomplete="list"
						aria-expanded={choices.length > 0}
						aria-controls={resultsId}
						aria-activedescendant={highlighted ? `${resultsId}-option-${active}` : undefined}
						placeholder="Start a chat with..."
						autoComplete="off"
						enterKeyHint={members.length >= MIN_MEMBERS && !needle ? "done" : "next"}
						readOnly={saving}
						value={query}
						onChange={(event) => {
							setQuery(event.target.value);
							setActive(null);
							setError(undefined);
						}}
						onKeyDown={(event) => {
							if (event.nativeEvent.isComposing || saving) return;
							if (event.key === "ArrowDown" && choices.length > 0) {
								event.preventDefault();
								setActive((index) => Math.min((index ?? -1) + 1, choices.length - 1));
							} else if (event.key === "ArrowUp" && choices.length > 0) {
								event.preventDefault();
								setActive((index) => Math.max((index ?? choices.length) - 1, 0));
							} else if (event.key === "Enter") {
								event.preventDefault();
								submit();
							} else if (event.key === "Backspace" && query === "" && members.length > 0) {
								event.preventDefault();
								remove(members[members.length - 1]!.id);
							}
						}}
					/>
				</div>
			</header>
			<div className="kb-group-create__suggestions">
				{choices.length > 0 ? (
					<div id={resultsId} className="kb-group-create__results" role="listbox" aria-label="Bots">
						{choices.map((bot, index) => (
							<button
								key={bot.id}
								type="button"
								id={`${resultsId}-option-${index}`}
								className="kb-group-create__option"
								role="option"
								aria-label={bot.name}
								aria-selected={active === index}
								disabled={full || saving}
								onClick={() => select(bot.id)}
							>
								<BotAvatar bot={bot} size={24} pointerArea=".kb-group-create__option" />
								<span className="kb-group-create__name">{bot.name}</span>
								<span className="kb-group-create__add" aria-hidden="true">
									Add to group chat
								</span>
							</button>
						))}
					</div>
				) : (
					<p className="kb-group-create__empty" role="status">
						{loading
							? "Loading bots..."
							: loadError
								? "Could not load bots."
								: needle
									? "No bots found"
									: members.length > 0
										? "All bots selected"
										: "No bots available"}
					</p>
				)}
				{(error || loadError) && (
					<p className="kb-group-create__error" role="alert">
						{error ?? loadError?.message}
					</p>
				)}
				{(full || saving) && (
					<p className="kb-group-create__hint" role="status">
						{saving ? "Creating group chat..." : `A group holds at most ${MAX_MEMBERS} bots. Press Enter to create.`}
					</p>
				)}
			</div>
		</form>
	);
}
