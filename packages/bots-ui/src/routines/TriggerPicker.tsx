// Every trigger kind a routine can have, and the fields for each. Trigger payloads reach the bot as outside text.
import type { Trigger } from "@knightcode/bots-protocol";
import { AtSign, CalendarClock, Eye, GitBranch, Hash, Mail, Plus, Webhook, X, Zap } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { Menu, MenuItem } from "../primitives/Menu.tsx";
import { Select } from "../primitives/Select.tsx";
import { useResource, useStore } from "../state/store.ts";

type Kind = Trigger["kind"];

const ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone;

/** The seven kinds, in menu order, with what a new one starts as. */
export const TRIGGER_KINDS: { kind: Kind; label: string; icon: ReactNode; start: () => Trigger }[] = [
	{
		kind: "schedule",
		label: "Schedule",
		icon: <CalendarClock size={14} />,
		start: () => ({ kind: "schedule", cron: "0 8 * * 1-5", timeZone: ZONE }),
	},
	{
		kind: "github",
		label: "GitHub",
		icon: <GitBranch size={14} />,
		start: () => ({ kind: "github", repo: "", events: ["pull_request.opened"] }),
	},
	{ kind: "slack", label: "Slack", icon: <Hash size={14} />, start: () => ({ kind: "slack", match: "mention" }) },
	{ kind: "email", label: "Email", icon: <Mail size={14} />, start: () => ({ kind: "email" }) },
	{
		kind: "composio",
		label: "App event",
		icon: <Zap size={14} />,
		start: () => ({ kind: "composio", appId: "", event: "" }),
	},
	{ kind: "webhook", label: "Webhook", icon: <Webhook size={14} />, start: () => ({ kind: "webhook" }) },
	{
		kind: "watch",
		label: "Watch for changes",
		icon: <Eye size={14} />,
		start: () => ({ kind: "watch", target: "connector", source: "", everyMinutes: 60, postNoChanges: false }),
	},
];

const label = (kind: Kind) => TRIGGER_KINDS.find((k) => k.kind === kind)!.label;

/** The Add trigger menu. */
export function AddTrigger({ onAdd }: { onAdd: (trigger: Trigger) => void }) {
	return (
		<Menu
			label="Trigger kinds"
			trigger={
				<Button variant="secondary" size="sm" aria-label="Add trigger">
					<Plus size={14} /> Add trigger
				</Button>
			}
		>
			{TRIGGER_KINDS.map((k) => (
				<MenuItem key={k.kind} icon={k.icon} onSelect={() => onAdd(k.start())}>
					{k.label}
				</MenuItem>
			))}
		</Menu>
	);
}

/** One trigger's card: its kind, its fields, and remove. `routineId` is set once the routine is saved. */
export function TriggerCard({
	trigger,
	onChange,
	onRemove,
	routineId,
}: {
	trigger: Trigger;
	onChange: (t: Trigger) => void;
	onRemove: () => void;
	routineId?: string;
}) {
	return (
		<div className="kb-trigger" role="group" aria-label={`${label(trigger.kind)} trigger`}>
			<div className="kb-trigger__head">
				<span className="kb-trigger__kind">{label(trigger.kind)}</span>
				<button
					type="button"
					className="kb-chip__remove"
					aria-label={`Remove ${label(trigger.kind)} trigger`}
					onClick={onRemove}
				>
					<X size={12} />
				</button>
			</div>
			<TriggerFields trigger={trigger} onChange={onChange} routineId={routineId} />
		</div>
	);
}

const SCHEDULES = [
	{ value: "0 8 * * 1-5", label: "Weekdays at 8:00" },
	{ value: "0 8 * * *", label: "Every day at 8:00" },
	{ value: "0 9 * * 1", label: "Mondays at 9:00" },
	{ value: "0 * * * *", label: "Every hour" },
	{ value: "custom", label: "Custom (cron)" },
];

const GITHUB_EVENTS: [string, string][] = [
	["pull_request.opened", "PR opened"],
	["pull_request.synchronize", "PR pushed"],
	["pull_request.merged", "PR merged"],
	["pull_request.closed", "PR closed"],
	["pull_request.review_requested", "Review requested"],
	["pull_request_review.approved", "Review approved"],
	["pull_request_review.changes_requested", "Changes requested"],
	["pull_request_review.commented", "Review commented"],
	["issue_comment.pr", "PR comment"],
	["pull_request_review_comment", "Inline review comment"],
	["pull_request_review_thread", "Review thread resolved or unresolved"],
	["issues.opened", "Issue opened"],
	["issues.assigned", "Issue assigned"],
	["check_suite.success", "CI passed"],
	["check_suite.failure", "CI failed"],
];

function TriggerFields({
	trigger,
	onChange,
	routineId,
}: {
	trigger: Trigger;
	onChange: (t: Trigger) => void;
	routineId?: string;
}) {
	switch (trigger.kind) {
		case "schedule": {
			const preset = SCHEDULES.some((s) => s.value === trigger.cron) ? trigger.cron! : "custom";
			return (
				<div className="kb-trigger__fields">
					<Select
						label="When"
						value={preset}
						options={SCHEDULES}
						onValueChange={(cron) => onChange({ ...trigger, cron: cron === "custom" ? (trigger.cron ?? "") : cron })}
					/>
					{preset === "custom" && (
						<Input
							aria-label="Cron expression"
							placeholder="0 8 * * 1-5"
							value={trigger.cron ?? ""}
							onChange={(e) => onChange({ ...trigger, cron: e.target.value })}
						/>
					)}
					<span className="kb-settings__hint">
						In {trigger.timeZone}. A missed run still happens after an outage, marked late.
					</span>
				</div>
			);
		}
		case "github":
			return (
				<div className="kb-trigger__fields">
					<Input
						aria-label="Repository"
						placeholder="owner/repo"
						value={trigger.repo}
						onChange={(e) => onChange({ ...trigger, repo: e.target.value })}
					/>
					<div className="kb-trigger__checks" role="group" aria-label="GitHub events">
						{GITHUB_EVENTS.map(([value, text]) => (
							<label key={value} className="kb-recipe__check">
								<input
									type="checkbox"
									checked={trigger.events.includes(value)}
									onChange={(e) =>
										onChange({
											...trigger,
											events: e.target.checked ? [...trigger.events, value] : trigger.events.filter((v) => v !== value),
										})
									}
								/>
								<span>{text}</span>
							</label>
						))}
					</div>
					{trigger.events.some((e) => e.startsWith("check_suite")) && (
						<Input
							aria-label="Branch"
							placeholder="Branch (optional)"
							value={trigger.branch ?? ""}
							onChange={(e) => onChange({ ...trigger, branch: e.target.value || undefined })}
						/>
					)}
					<Input
						aria-label="Only events by"
						placeholder="Only events by these GitHub users (optional, comma separated)"
						value={(trigger.users ?? []).join(", ")}
						onChange={(e) => onChange({ ...trigger, users: splitList(e.target.value) })}
					/>
				</div>
			);
		case "slack":
			return (
				<div className="kb-trigger__fields">
					<Input
						aria-label="Channel"
						placeholder="#channel, or leave empty for any channel it is in"
						value={trigger.channel ?? ""}
						onChange={(e) => onChange({ ...trigger, channel: e.target.value || undefined })}
					/>
					<Select
						label="Fires on"
						value={trigger.match}
						onValueChange={(match) => onChange({ ...trigger, match: match as typeof trigger.match })}
						options={[
							{ value: "mention", label: "A mention" },
							{ value: "keyword", label: "A message with a keyword" },
							{ value: "reaction", label: "An emoji reaction" },
							{ value: "any", label: "Any message" },
						]}
					/>
					{trigger.match === "keyword" && (
						<Input
							aria-label="Keyword"
							value={trigger.keyword ?? ""}
							onChange={(e) => onChange({ ...trigger, keyword: e.target.value })}
						/>
					)}
					{trigger.match === "reaction" && (
						<>
							<Input
								aria-label="Emoji"
								placeholder=":eyes:"
								value={trigger.emoji ?? ""}
								onChange={(e) => onChange({ ...trigger, emoji: e.target.value })}
							/>
							<label className="kb-recipe__check">
								<input
									type="checkbox"
									checked={trigger.ownReactionsOnly ?? false}
									onChange={(e) => onChange({ ...trigger, ownReactionsOnly: e.target.checked })}
								/>
								<span>Only my own reactions</span>
							</label>
						</>
					)}
				</div>
			);
		case "email":
			return (
				<div className="kb-trigger__fields">
					<Input
						aria-label="From"
						placeholder="Only mail from (optional)"
						value={trigger.from ?? ""}
						onChange={(e) => onChange({ ...trigger, from: e.target.value || undefined })}
					/>
					<label className="kb-recipe__check">
						<input
							type="checkbox"
							checked={trigger.allowUnauthenticated ?? false}
							onChange={(e) => onChange({ ...trigger, allowUnauthenticated: e.target.checked })}
						/>
						<span>Also fire on mail that fails SPF and DKIM</span>
					</label>
				</div>
			);
		case "composio":
			return <AppEventFields trigger={trigger} onChange={onChange} />;
		case "webhook":
			return <WebhookFields routineId={routineId} />;
		case "watch":
			return <WatchFields trigger={trigger} onChange={onChange} />;
	}
}

function AppEventFields({
	trigger,
	onChange,
}: {
	trigger: Extract<Trigger, { kind: "composio" }>;
	onChange: (t: Trigger) => void;
}) {
	const { data } = useResource("catalog", (api) => api.listCatalog({}));
	const apps = (data?.entries ?? []).filter((e) => e.connection?.status === "connected");
	const { data: events } = useResource(`events:${trigger.appId}`, (api) =>
		trigger.appId ? api.listAppEvents({ appId: trigger.appId }) : Promise.resolve({ events: [] }),
	);
	if (apps.length === 0) return <p className="kb-settings__hint">Connect an app that offers events first.</p>;
	return (
		<div className="kb-trigger__fields">
			<Select
				label="App"
				value={trigger.appId || " "}
				onValueChange={(appId) => onChange({ ...trigger, appId, event: "" })}
				options={[{ value: " ", label: "Choose an app" }, ...apps.map((a) => ({ value: a.id, label: a.name }))]}
			/>
			{trigger.appId && (
				<Select
					label="Event"
					value={trigger.event || " "}
					onValueChange={(event) => onChange({ ...trigger, event: event.trim() })}
					options={[
						{ value: " ", label: "Choose an event" },
						...(events?.events ?? []).map((e) => ({ value: e.id, label: e.name })),
					]}
				/>
			)}
		</div>
	);
}

/** The URL exists only in the mint response: shown once, never stored in the routine. */
function WebhookFields({ routineId }: { routineId?: string }) {
	const store = useStore();
	const [url, setUrl] = useState<string>();
	if (!routineId) return <p className="kb-settings__hint">Save the routine to get its webhook URL.</p>;
	return (
		<div className="kb-trigger__fields">
			{url ? (
				<>
					<Input aria-label="Webhook URL" readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
					<span className="kb-settings__hint">Copy it now: it is shown only once. It works like a password.</span>
				</>
			) : (
				<Button
					variant="secondary"
					size="sm"
					onClick={() => void store.api.mintWebhook({ id: routineId }).then((r) => setUrl(r.url))}
				>
					<AtSign size={14} /> Get webhook URL
				</Button>
			)}
		</div>
	);
}

const EVERY = [
	{ value: "5", label: "Every 5 minutes" },
	{ value: "15", label: "Every 15 minutes" },
	{ value: "60", label: "Every hour" },
	{ value: "360", label: "Every 6 hours" },
	{ value: "1440", label: "Every day" },
];

function WatchFields({
	trigger,
	onChange,
}: {
	trigger: Extract<Trigger, { kind: "watch" }>;
	onChange: (t: Trigger) => void;
}) {
	const store = useStore();
	const [hours, setHours] = useState<number>();
	const needsComputer = trigger.target !== "connector";
	useEffect(() => {
		if (!needsComputer) return setHours(undefined);
		let live = true;
		void store.api.estimateWatch({ trigger }).then((r) => live && setHours(r.computerHoursPerMonth));
		return () => {
			live = false;
		};
	}, [store, needsComputer, trigger]);
	return (
		<div className="kb-trigger__fields">
			<label className="kb-field">
				<span className="kb-field__label">What to watch</span>
				<select
					className="kb-native-select"
					aria-label="What to watch"
					value={trigger.target}
					onChange={(e) => onChange({ ...trigger, target: e.target.value as typeof trigger.target })}
				>
					<option value="connector">A connected app</option>
					<option value="file">A file or folder</option>
					<option value="command">A command's output</option>
				</select>
			</label>
			<Input
				aria-label="Source"
				placeholder={
					trigger.target === "connector"
						? "Which read, for example Gmail: unread from my boss"
						: trigger.target === "file"
							? "~/shared/reports"
							: "curl -s https://example.com/status"
				}
				value={trigger.source}
				onChange={(e) => onChange({ ...trigger, source: e.target.value })}
			/>
			<Select
				label="How often"
				value={String(trigger.everyMinutes)}
				options={EVERY}
				onValueChange={(v) => onChange({ ...trigger, everyMinutes: Number(v) })}
			/>
			<label className="kb-recipe__check">
				<input
					type="checkbox"
					checked={trigger.postNoChanges}
					onChange={(e) => onChange({ ...trigger, postNoChanges: e.target.checked })}
				/>
				<span>Post "No changes" each time</span>
			</label>
			{needsComputer && (
				<p className="kb-settings__hint" data-testid="computer-hours-estimate">
					Needs the computer: checks run when it is awake, otherwise at most hourly. About {hours ?? "…"} computer hours
					a month.
				</p>
			)}
		</div>
	);
}

function splitList(text: string): string[] | undefined {
	const list = text
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return list.length ? list : undefined;
}
