// "Create New Bot": name and avatar, or start from a template, or import an agent from another app. The three views
// share one dialog of fixed size; the tabs sit at the foot so the create form keeps its measured layout.
import { ApiError, AVATAR_COLORS, AVATAR_SHAPES, type Avatar, type Template } from "@knightcode/bots-protocol";
import { useRef, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input } from "../primitives/Input.tsx";
import { Tabs } from "../primitives/Tabs.tsx";
import { navigate } from "../shell/routes.ts";
import { BOTS, useStore } from "../state/store.ts";
import { ImportAgent } from "./ImportAgent.tsx";
import { Templates } from "./Templates.tsx";

export type CreateTab = "create" | "templates" | "import";

const pick = <T,>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)]!;

/** The dialog, open while the route is /new. */
export function CreateBot({ tab, onClose }: { tab: CreateTab; onClose: () => void }) {
	const store = useStore();
	const [name, setName] = useState("");
	const [avatar, setAvatar] = useState<Avatar>(() => ({ shape: pick(AVATAR_SHAPES), color: pick(AVATAR_COLORS) }));
	const [template, setTemplate] = useState<Template>();
	const [error, setError] = useState<string>();
	const [busy, setBusy] = useState(false);
	const nameField = useRef<HTMLInputElement>(null);
	const go = (next: CreateTab) => navigate({ name: "new", tab: next }, { replace: true });

	const create = async () => {
		setBusy(true);
		setError(undefined);
		try {
			const bot = await store.api.createBot({ name: name.trim(), avatar, templateId: template?.id });
			store.reload(BOTS);
			navigate({ name: "bot", botId: bot.id, pane: "details" });
		} catch (cause) {
			setError(describeError(cause));
		} finally {
			setBusy(false);
		}
	};
	const useTemplate = (chosen: Template) => {
		setTemplate(chosen);
		setName(chosen.name);
		setAvatar(chosen.avatar);
		go("create");
	};

	const tabs = (
		<Tabs
			label="Ways to start"
			value={tab === "import" ? "templates" : tab}
			onValueChange={(next) => go(next as CreateTab)}
			listClassName="kb-create__tabs"
			items={[
				{ value: "create", label: "Create" },
				{ value: "templates", label: "Templates" },
			]}
		/>
	);
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Create New Bot"
			width={440}
			className="kb-create"
			dataRef="dialog"
			onOpenAutoFocus={(event) => {
				// The name comes first; on the other views, focus stays on the dialog itself.
				event.preventDefault();
				if (tab === "create") nameField.current?.focus();
			}}
			footer={
				tab === "import" ? undefined : (
					<>
						{tabs}
						<span className="kb-create__spacer" />
						<Button variant="secondary" onClick={onClose} data-ref="cancel">
							Cancel
						</Button>
						<Button
							variant="primary"
							disabled={!name.trim() || busy || tab !== "create"}
							onClick={() => void create()}
							data-ref="create"
						>
							Create
						</Button>
					</>
				)
			}
		>
			{tab === "create" && (
				<div className="kb-dialog__body kb-create__body">
					<div className="kb-create__form">
						<span className="kb-create__preview" data-avatar-box="">
							<BotAvatarView shape={avatar.shape} color={avatar.color} size={96} />
						</span>
						<Input
							ref={nameField}
							className="kb-create__name"
							aria-label="Bot name"
							placeholder="Name your Bot"
							value={name}
							maxLength={60}
							onChange={(event) => setName(event.target.value)}
							onKeyDown={(event) => event.key === "Enter" && name.trim() && void create()}
							data-ref="name-input"
						/>
						{template && (
							<p className="kb-create__note">
								From the {template.name} template.{" "}
								<button type="button" className="kb-link-button" onClick={() => setTemplate(undefined)}>
									Start blank
								</button>
							</p>
						)}
						{error && (
							<p className="kb-create__error" role="alert">
								{error}
							</p>
						)}
						<AvatarPicker value={avatar} onChange={setAvatar} />
					</div>
				</div>
			)}
			{tab === "templates" && <Templates onPick={useTemplate} onImport={() => go("import")} />}
			{tab === "import" && <ImportAgent tabs={tabs} onCancel={onClose} />}
		</Dialog>
	);
}

/** Shape and colour pickers: five shapes to a row (three rows show; the rest scroll), eleven colours. */
export function AvatarPicker({ value, onChange }: { value: Avatar; onChange: (avatar: Avatar) => void }) {
	return (
		<div className="kb-avatar-picker">
			<div className="kb-avatar-picker__shapes" role="radiogroup" aria-label="Character shape" data-ref="shape-group">
				{AVATAR_SHAPES.map((shape, i) => (
					<button
						key={shape}
						type="button"
						role="radio"
						aria-checked={value.shape === shape}
						aria-label={`${shape} character shape`}
						className="kb-avatar-picker__shape"
						data-ref={i === 0 ? "shape-option" : undefined}
						onClick={() => onChange({ ...value, shape })}
					>
						<span className="kb-avatar-picker__highlight" aria-hidden />
						<span className="kb-avatar-picker__mark" data-avatar-box="">
							<BotAvatarView shape={shape} color={value.color} size={36} />
						</span>
					</button>
				))}
			</div>
			<div className="kb-avatar-picker__colors" role="radiogroup" aria-label="Character color" data-ref="color-group">
				{AVATAR_COLORS.map((color, i) => (
					<button
						key={color}
						type="button"
						role="radio"
						aria-checked={value.color === color}
						aria-label={`${color[0]!.toUpperCase()}${color.slice(1)} character color`}
						className="kb-avatar-picker__color"
						data-ref={i === 0 ? "color-option" : undefined}
						onClick={() => onChange({ ...value, color })}
					>
						<span className="kb-avatar-picker__swatch" style={{ backgroundColor: `var(--kb-avatar-${color})` }} />
					</button>
				))}
			</div>
		</div>
	);
}

/** A sentence for a failed create or import. */
export function describeError(cause: unknown): string {
	if (cause instanceof ApiError && cause.code === "model_required")
		return "Choose a default model in Settings first. KnightCode never picks one for you.";
	if (cause instanceof ApiError) return cause.message;
	return "Something went wrong. Try again.";
}
