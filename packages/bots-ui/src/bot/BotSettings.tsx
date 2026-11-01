// Everything about one bot that is not in the details pane: avatar, name, what it is for, instructions and their
// history, model, knowledge files, notifications, tools shown, and export. Opened from the pane's avatar, the row
// menu, or /bots/<id>/settings?edit=1. Credentials, tools and approval rules stay out of chat; here they are explicit.
import type { Bot, Notify } from "@knightcode/bots-protocol";
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input, Textarea } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { Toggle } from "../primitives/Toggle.tsx";
import { navigate } from "../shell/routes.ts";
import { BOTS, type BotList, useStore } from "../state/store.ts";
import { AvatarPicker } from "./CreateBot.tsx";
import { ExportBot } from "./ExportBot.tsx";
import { InstructionsHistory } from "./InstructionsHistory.tsx";
import { KnowledgeFiles } from "./KnowledgeFiles.tsx";
import { ManagedBots } from "./ManagedBots.tsx";
import { ModelPicker } from "./ModelPicker.tsx";

type Patch = Partial<
	Pick<Bot, "name" | "purpose" | "instructions" | "model" | "avatar" | "notify" | "showTools" | "suggestions">
>;

/** The dialog. Each field saves when it changes; instructions save as a new version. */
export function BotSettings({ bot, onClose }: { bot: Bot; onClose: () => void }) {
	const store = useStore();
	const [name, setName] = useState(bot.name);
	const [purpose, setPurpose] = useState(bot.purpose);
	const [instructions, setInstructions] = useState(bot.instructions);
	const [history, setHistory] = useState(false);
	useEffect(() => setInstructions(bot.instructions), [bot.instructions]);
	const update = async (patch: Patch) => {
		const next = await store.api.updateBot({ botId: bot.id, ...patch });
		store.set<BotList>(BOTS, (list) => list && { ...list, bots: list.bots.map((b) => (b.id === next.id ? next : b)) });
	};
	const saveText = (field: "name" | "purpose", value: string) => {
		const trimmed = value.trim();
		if (field === "name" && !trimmed) return setName(bot.name);
		if (trimmed !== bot[field]) void update({ [field]: trimmed });
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title={`${bot.name} settings`}
			width={560}
			className="kb-bot-settings"
		>
			<div className="kb-dialog__body kb-settings">
				<Field label="Avatar">
					<AvatarPicker value={bot.avatar} onChange={(avatar) => void update({ avatar })} />
				</Field>
				<Field label="Name">
					<Input
						aria-label="Name"
						value={name}
						maxLength={60}
						onChange={(e) => setName(e.target.value)}
						onBlur={() => saveText("name", name)}
					/>
				</Field>
				<Field label="What I'm for" hint="One line. Other bots read it to know when to ask this one.">
					<Input
						aria-label="What I'm for"
						value={purpose}
						maxLength={160}
						onChange={(e) => setPurpose(e.target.value)}
						onBlur={() => saveText("purpose", purpose)}
					/>
				</Field>
				<Field label="Instructions">
					<Textarea
						aria-label="Instructions"
						rows={6}
						value={instructions}
						onChange={(e) => setInstructions(e.target.value)}
					/>
					<div className="kb-settings__row">
						<Button variant="subtle" size="sm" onClick={() => setHistory(!history)} aria-expanded={history}>
							{history ? "Hide history" : "History"}
						</Button>
						<Button
							variant="primary"
							size="sm"
							disabled={instructions === bot.instructions}
							onClick={() => void update({ instructions })}
						>
							Save instructions
						</Button>
					</div>
					{history && <InstructionsHistory bot={bot} />}
				</Field>
				<Field label="Model">
					<ModelPicker value={bot.model} onChange={(model) => void update({ model })} />
				</Field>
				<Field label="Knowledge files" hint="Reference documents this bot reads when they are relevant.">
					<KnowledgeFiles bot={bot} />
				</Field>
				<Field label="Notifications">
					<Select
						label="Notifications"
						value={bot.notify}
						onValueChange={(notify) => void update({ notify: notify as Notify })}
						options={[
							{ value: "finish", label: "When it finishes" },
							{ value: "input", label: "When it needs me" },
							{ value: "never", label: "Never" },
						]}
					/>
				</Field>
				<Field label="Suggestions" hint="Let it propose work it noticed.">
					<Toggle
						label="Suggestions"
						checked={bot.suggestions}
						onCheckedChange={(suggestions) => void update({ suggestions })}
					/>
				</Field>
				<Field label="Show tools used" hint="List the tools behind each reply.">
					<Toggle
						label="Show tools used"
						checked={bot.showTools}
						onCheckedChange={(showTools) => void update({ showTools })}
					/>
				</Field>
				<Field label="Manages" hint="Bots this one may change (a Chief of Staff).">
					<ManagedBots bot={bot} />
				</Field>
				<Field label="Memory">
					<Button variant="subtle" size="sm" onClick={() => navigate({ name: "bot", botId: bot.id, pane: "memory" })}>
						Open memory
					</Button>
				</Field>
				<Field label="Share">
					<ExportBot bot={bot} />
				</Field>
			</div>
		</Dialog>
	);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
	return (
		<section className="kb-settings__field">
			<div className="kb-settings__label">{label}</div>
			{hint && <p className="kb-settings__hint">{hint}</p>}
			{children}
		</section>
	);
}
