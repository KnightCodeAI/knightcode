// A routine: its prompt, triggers (any of which fires it), standing grant, optional model, Active, Test run and run
// history. Shown in the bot's details pane.
import type { Bot, Grant, Routine, Trigger } from "@knightcode/bots-protocol";
import { ChevronLeft } from "lucide-react";
import { useEffect, useState } from "react";
import { ModelPicker } from "../bot/ModelPicker.tsx";
import { Button } from "../primitives/Button.tsx";
import { Input, Textarea } from "../primitives/Input.tsx";
import { Toggle } from "../primitives/Toggle.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { useResource, useStore } from "../state/store.ts";
import { GrantEditor } from "./GrantEditor.tsx";
import { RunHistory } from "./RunHistory.tsx";
import { AddTrigger, TriggerCard } from "./TriggerPicker.tsx";

const EMPTY_GRANT: Grant = { actions: [], targets: [], limits: {} };

/** The editor for `routineId`, or a new routine. */
export function RoutineEditor({ bot, routineId }: { bot: Bot; routineId?: string }) {
	const { data: existing } = useResource(`routine:${routineId ?? "new"}`, (api) =>
		routineId ? api.getRoutine({ id: routineId }) : Promise.resolve(undefined),
	);
	if (routineId && !existing) return null;
	return <Editor key={routineId ?? "new"} bot={bot} routine={existing} />;
}

function Editor({ bot, routine }: { bot: Bot; routine?: Routine }) {
	const store = useStore();
	const toast = useToast();
	const skill = useQueryParam("skill");
	const [name, setName] = useState(routine?.name ?? "");
	const [prompt, setPrompt] = useState(routine?.prompt ?? (skill ? `Use the "${skill}" skill.` : ""));
	const [triggers, setTriggers] = useState<Trigger[]>(routine?.triggers ?? []);
	const [grant, setGrant] = useState<Grant>(routine?.grant ?? EMPTY_GRANT);
	const [active, setActive] = useState(routine?.active ?? true);
	const [ownModel, setOwnModel] = useState(routine?.model !== undefined);
	const [model, setModel] = useState(routine?.model ?? bot.model);
	const [busy, setBusy] = useState(false);
	const runsKey = `runs:routine:${routine?.id}`;
	const { data: runs } = useResource(runsKey, (api) =>
		routine ? api.listRuns({ routineId: routine.id }) : Promise.resolve({ runs: [] }),
	);
	useEffect(() => setActive(routine?.active ?? true), [routine?.active]);

	const fields = { name: name.trim(), prompt, triggers, grant, active, model: ownModel ? model : undefined };
	const back = () => navigate({ name: "bot", botId: bot.id, pane: "details" });
	const save = async () => {
		setBusy(true);
		try {
			if (routine) await store.api.updateRoutine({ id: routine.id, ...fields });
			else {
				const created = await store.api.createRoutine({ botId: bot.id, ...fields });
				navigate(`/bots/${encodeURIComponent(bot.id)}/routines/${encodeURIComponent(created.id)}`, { replace: true });
			}
			store.reload(`routines:${bot.id}`);
			store.reload("routines:all");
			toast({ text: `Saved "${fields.name}"` });
		} finally {
			setBusy(false);
		}
	};
	return (
		<div className="kb-routine">
			<button type="button" className="kb-browser__back kb-routine__back" onClick={back}>
				<ChevronLeft size={14} />
				<span>Details</span>
			</button>
			<Input
				aria-label="Routine name"
				placeholder="Routine name"
				value={name}
				onChange={(e) => setName(e.target.value)}
			/>
			<Textarea
				aria-label="What to do"
				placeholder="What should the bot do each time?"
				rows={4}
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
			/>
			{routine?.note && <p className="kb-settings__hint">From the import: {routine.note}</p>}
			<section className="kb-settings__field" aria-label="Triggers">
				<div className="kb-routine__head">
					<span className="kb-settings__label">Triggers</span>
					<AddTrigger onAdd={(trigger) => setTriggers((list) => [...list, trigger])} />
				</div>
				{triggers.length === 0 && <p className="kb-settings__hint">No trigger yet: it runs only when you test it.</p>}
				{triggers.map((trigger, i) => (
					<TriggerCard
						key={i}
						trigger={trigger}
						routineId={routine?.id}
						onChange={(next) => setTriggers((list) => list.map((t, j) => (j === i ? next : t)))}
						onRemove={() => setTriggers((list) => list.filter((_, j) => j !== i))}
					/>
				))}
			</section>
			<GrantEditor value={grant} onChange={setGrant} />
			<section className="kb-settings__field">
				<label className="kb-recipe__check">
					<input type="checkbox" checked={ownModel} onChange={(e) => setOwnModel(e.target.checked)} />
					<span>Use its own model</span>
				</label>
				{ownModel && <ModelPicker value={model} onChange={setModel} />}
			</section>
			<div className="kb-routine__head">
				<span>Active</span>
				<Toggle label="Active" checked={active} onCheckedChange={setActive} />
			</div>
			<div className="kb-settings__row">
				{routine && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() =>
							void store.api.deleteRoutine({ id: routine.id }).then(() => (store.reload(`routines:${bot.id}`), back()))
						}
					>
						Delete
					</Button>
				)}
				{routine && (
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void store.api.testRoutine({ id: routine.id }).then(() => store.reload(runsKey))}
					>
						Test run
					</Button>
				)}
				<Button variant="primary" size="sm" disabled={!fields.name || busy} onClick={() => void save()}>
					Save
				</Button>
			</div>
			{routine && (
				<section className="kb-settings__field" aria-label="Run history">
					<span className="kb-settings__label">Run history</span>
					<RunHistory runs={runs?.runs ?? []} onChange={() => store.reload(runsKey)} />
				</section>
			)}
		</div>
	);
}
