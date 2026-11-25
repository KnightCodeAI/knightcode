/** Standard composer presentation, shared with external editor replacements through the public SDK. */
import { useEffect, useState, type ReactNode } from "react";
import { registerComposerCommands } from "./commands.ts";
import {
	defineDesktopExtension,
	experimental_useComposer,
	experimental_controls,
	experimental_icons,
	experimental_shellServices,
	experimental_Button as Button,
	experimental_imageThumbnail,
	experimental_TextareaEditor as TextareaEditor,
	experimental_ComposerContributions as Contributions,
} from "@knightcodeai/cli/desktop";
/** An attached image as a thumbnail; the file name shows on hover. */
function ImageChip({ path, onRemove }: { path: string; onRemove: () => void }) {
	const { experimental_Tooltip: Tooltip } = experimental_controls();
	const { ImagePlus, X } = experimental_icons();
	const { experimental_basename: basename } = experimental_shellServices();
	const [src, setSrc] = useState<string>();
	useEffect(() => {
		void experimental_imageThumbnail(path).then(setSrc);
	}, [path]);
	return (
		<Tooltip content={basename(path)}>
			<span className="group relative size-14 overflow-hidden rounded-lg border border-line bg-ghost-hover">
				{src ? (
					<img src={src} alt={basename(path)} className="size-full object-cover" />
				) : (
					<ImagePlus size={16} className="m-auto mt-[19px] text-secondary" />
				)}
				{/* Its label stays unspoken on hover: the thumbnail's own tooltip already shows. */}
				<button
					type="button"
					aria-label="Remove image"
					onClick={onRemove}
					className="absolute top-0.5 right-0.5 rounded-full bg-black/60 p-0.5 text-white opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
				>
					<X size={11} />
				</button>
			</span>
		</Tooltip>
	);
}

/**
 * Codex's queued message row: its text on one line, then Steer (send it into the running turn now), Delete, and a …
 * menu with Edit message (take it back into the field). A message already steering only shows its text.
 */
function QueuedRow({
	text,
	steering,
	attachments,
	onSteer,
	onDelete,
	onEdit,
}: {
	text: string;
	steering: boolean;
	/** Images or review comments: steering or editing would carry the text only, so only Delete is offered. */
	attachments?: number;
	onSteer: () => void;
	onDelete: () => void;
	onEdit: () => void;
}) {
	const {
		experimental_Tooltip: Tooltip,
		experimental_IconButton: IconButton,
		experimental_Menu: Menu,
		experimental_MenuTrigger: MenuTrigger,
		experimental_MenuContent: MenuContent,
		experimental_MenuItem: MenuItem,
	} = experimental_controls();
	const { Trash2, MoreHorizontal, Pencil } = experimental_icons();
	return (
		<div className="flex min-h-7 items-center gap-2 text-base text-secondary">
			<Tooltip content={text} overflow>
				<span className="min-w-0 flex-1 truncate leading-5">
					{steering ? <span className="me-2 text-sm text-tertiary">Steering</span> : null}
					{text}
				</span>
			</Tooltip>
			{steering ? null : (
				<div className="flex shrink-0 items-center gap-0.5">
					{attachments ? null : (
						<Tooltip content="Submit without interrupting the model">
							<Button color="secondary" size="xs" pill onClick={onSteer} className="px-2">
								Steer
							</Button>
						</Tooltip>
					)}
					<IconButton label="Delete queued message" size="xs" round onClick={onDelete}>
						<Trash2 size={14} />
					</IconButton>
					{attachments ? null : (
						<Menu>
							<MenuTrigger>
								<IconButton label="Queued message actions" size="xs" round>
									<MoreHorizontal size={14} />
								</IconButton>
							</MenuTrigger>
							<MenuContent align="end" side="top" minWidth={0}>
								<MenuItem icon={<Pencil />} onSelect={onEdit}>
									Edit message
								</MenuItem>
							</MenuContent>
						</Menu>
					)}
				</div>
			)}
		</div>
	);
}

export function ComposerFrame({ editor }: { editor?: ReactNode }) {
	const {
		threadId,
		project,
		images,
		running,
		hasContent,
		canSend,
		canStop,
		parts,
		queued,
		suggestions,
		selected,
		dragging,
		boxRef,
		panelRef,
		setSelected,
		accept,
		toggleAddMenu,
		submit,
		stop,
		removeImage,
		queueSteer,
		queueDelete,
		queueEdit,
		dropProps,
		onKeyDown,
		usage,
		showContextUsage,
		whileRunning,
	} = experimental_useComposer();
	const { experimental_Tooltip: Tooltip, experimental_IconButton: IconButton } = experimental_controls();
	const { ArrowUp, Check, FileText, Folder, ImagePlus, Lightbulb, Plus, Sparkles, Square, SquareSlash } =
		experimental_icons();
	const { experimental_tokens: tokens } = experimental_shellServices();
	const SUGGESTION_ICONS = {
		file: FileText,
		folder: Folder,
		command: SquareSlash,
		skill: Sparkles,
		image: ImagePlus,
		plan: Lightbulb,
	};
	return (
		<div data-composer className="@container mx-auto w-full max-w-3xl px-4 pt-1.5 pb-4" onKeyDown={onKeyDown}>
			<div ref={boxRef} className="relative">
				<Contributions host="banners" />
				{/* A new thread's utility bar, tucked under the composer's top edge (Codex's): the project and the
				    environment. The suggestion panel takes its place while open. */}
				{project ? (
					<div
						className={`relative mx-[13px] -mb-1 rounded-t-[20px] bg-composer-bar px-1 pb-1 ${suggestions ? "invisible" : ""}`}
					>
						<div role="group" aria-label="Composer utility bar" className="flex items-center gap-2 py-[5px] ps-0.5">
							{parts.project}
							<div className="flex-1" />
							{parts.workspace}
						</div>
					</div>
				) : null}
				<div
					data-dragging={dragging || undefined}
					{...dropProps}
					className="relative rounded-composer bg-composer shadow-[var(--kc-composer-ring)]"
				>
					{/* The "/", "@" and "+" panel: as wide as the composer, 8px above it, as Codex's. */}
					<div
						hidden={!suggestions}
						className="kc-menu kc-menu-solid absolute inset-x-0 bottom-full mb-2 flex max-h-80 flex-col overflow-hidden"
					>
						<div ref={panelRef} className="min-h-0 overflow-y-auto">
							{suggestions?.items.map((s, i) => {
								const Icon = SUGGESTION_ICONS[s.icon];
								return (
									<div key={s.key}>
										{s.section && s.section !== suggestions.items[i - 1]?.section ? (
											<div className="kc-menu-label">{s.section}</div>
										) : null}
										<button
											type="button"
											data-active={i === selected}
											onMouseDown={(e) => {
												e.preventDefault();
												accept(s);
											}}
											onMouseEnter={() => setSelected(i)}
											className="kc-row gap-2 text-ink"
										>
											<Icon size={16} className="shrink-0" />
											<span className="shrink-0">{s.label}</span>
											{s.detail ? <span className="min-w-0 truncate text-tertiary">{s.detail}</span> : null}
										</button>
									</div>
								);
							})}
							<Contributions host="suggestions" />
							<Contributions host="addMenu" />
							{suggestions?.truncated ? (
								<div className="px-2 py-1 text-xs text-tertiary">Some files may be missing</div>
							) : null}
						</div>
					</div>
					<Contributions host="popups" />
					{dragging ? (
						<div className="kc-drop-target pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-composer text-base font-semibold text-ink">
							Drop files to attach
						</div>
					) : null}
					{queued.length > 0 ? (
						<div className="flex flex-col gap-1 border-b border-line px-4 py-2">
							{queued.map((q, i) => (
								<QueuedRow
									key={q.id ?? `s${i}`}
									text={q.text}
									steering={q.steer}
									attachments={"attachments" in q ? q.attachments : undefined}
									onSteer={() => q.id && queueSteer(q.id, q.text)}
									onDelete={() => q.id && queueDelete(q.id)}
									onEdit={() => q.id && queueEdit(q.id, q.text)}
								/>
							))}
						</div>
					) : null}
					{threadId ? <div className="flex flex-wrap gap-2 px-4 pt-3 empty:hidden">{parts.comments}</div> : null}
					<Contributions host="chips" />
					{images.length > 0 ? (
						<div className="flex flex-wrap gap-2 px-4 pt-3">
							{images.map((path) => (
								<ImageChip key={path} path={path} onRemove={() => removeImage(path)} />
							))}
						</div>
					) : null}
					<div className="px-2 pt-[14px]">{editor ?? <TextareaEditor />}</div>
					<div className="flex items-center gap-[5px] px-2 pt-[5px] pb-[7px]">
						<IconButton
							label="Add files and more"
							round
							onMouseDown={(e) => e.preventDefault()}
							onClick={() => void toggleAddMenu()}
							aria-expanded={suggestions?.items[0]?.section === "Add"}
							className="!text-ink"
						>
							<Plus size={16} />
						</IconButton>
						{parts.permissions}
						<Contributions host="actions" />
						<Contributions host="sendMenu" />
						<div className="flex-1" />
						{showContextUsage && usage?.contextTokens && usage.contextWindow ? (
							<Tooltip
								content={`${tokens(usage.contextTokens)} of ${tokens(usage.contextWindow)} tokens · $${usage.cost.toFixed(2)} this thread`}
							>
								<span
									className="mr-1 flex text-tertiary"
									aria-label={`${Math.round((usage.contextTokens / usage.contextWindow) * 100)}% of context used`}
								>
									<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.75}>
										<circle cx="8" cy="8" r="5.5" strokeOpacity={0.3} />
										<circle
											cx="8"
											cy="8"
											r="5.5"
											pathLength={100}
											strokeDasharray={`${Math.min(100, (usage.contextTokens / usage.contextWindow) * 100)} 100`}
											transform="rotate(-90 8 8)"
										/>
									</svg>
								</span>
							</Tooltip>
						) : null}
						{parts.model}
						{running && !hasContent ? (
							<Tooltip content="Stop">
								<Button variant="accent" pill uniform aria-label="Stop" disabled={!canStop} onClick={stop}>
									<Square size={14} fill="currentColor" />
								</Button>
							</Tooltip>
						) : (
							<Tooltip content={running ? (whileRunning === "queue" ? "Queue" : "Steer") : "Send"}>
								<Button
									variant="accent"
									pill
									uniform
									aria-label={running ? (whileRunning === "queue" ? "Queue" : "Steer") : "Send"}
									disabled={!canSend}
									onClick={() => submit(false)}
								>
									{running ? <Check size={14} strokeWidth={1.7} /> : <ArrowUp size={16} strokeWidth={1.6} />}
								</Button>
							</Tooltip>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}

export default defineDesktopExtension((app) => {
	registerComposerCommands(app);
	app.experimental_registerProvider({
		id: "default",
		surface: "composer",
		experimental_render: () => <ComposerFrame />,
	});
});
