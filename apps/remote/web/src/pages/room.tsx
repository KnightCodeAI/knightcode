import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Link2, Loader2, MoreHorizontal, Square, Trash2 } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CommandList } from "@/components/command-list";
import { GlassButton, GlassLink, TopBar } from "@/components/glass";
import { Stats, ToolSheet } from "@/components/tool-sheet";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { deleteRoom, shortenPath } from "@/lib/api";
import { Markdown } from "@/lib/markdown";
import { useKeyboardFrame, useRoomSocket } from "@/lib/socket";
import { groupStats, isRunning, rowLabel } from "@/lib/tools";
import { type Block, toBlocks, type ToolCallView } from "@/lib/transcript";

const NEAR_BOTTOM_PX = 96;
const MAX_DRAFT_HEIGHT_PX = 160;

/**
 * Focusing the composer low on the page makes iOS Safari pan the whole page up to clear the
 * keyboard, and it reports the pan only once it has finished, so the frame is drawn in the wrong
 * place for half a second. Safari measures the field inside focus(); lifting it far above the page
 * for that call leaves nothing to reveal (react-aria's usePreventScroll does the same). The
 * transform is cleared before the next paint, so it never shows.
 */
function focusWithoutPan(node: HTMLTextAreaElement): void {
	node.style.transform = "translateY(-2000px)";
	node.focus({ preventScroll: true });
	requestAnimationFrame(() => {
		node.style.transform = "";
	});
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
	return (
		<div className="flex justify-end">
			<div className="max-w-[86%] rounded-[1.25rem] rounded-br-lg bg-raised px-4 py-2.5 text-[16px] leading-relaxed break-words whitespace-pre-wrap">
				{text}
			</div>
		</div>
	);
}

/** Live, it stays open and shimmers in place of "Working…"; it folds shut once the reply starts. */
function Thinking({ text, live = false }: { text: string; live?: boolean }): React.JSX.Element {
	return (
		<details className="group mb-2" open={live}>
			<summary className="cursor-pointer list-none text-[14px] text-label-3 select-none">
				{live ? (
					<span className="shimmer font-medium">Thinking…</span>
				) : (
					<>
						<span className="group-open:hidden">Thought about it</span>
						<span className="hidden group-open:inline">Thinking</span>
					</>
				)}
			</summary>
			<p className="mt-1.5 border-l-2 border-hairline pl-3 text-[14px] leading-relaxed whitespace-pre-wrap text-label-2">
				{text}
			</p>
		</details>
	);
}

function ToolsRow({ calls, onOpen }: { calls: ToolCallView[]; onOpen(): void }): React.JSX.Element {
	const running = calls.some(isRunning);
	const stats = groupStats(calls);
	return (
		<button
			type="button"
			onClick={onOpen}
			className="-mx-2 -my-1 flex max-w-full items-center gap-1 rounded-xl px-2 py-1.5 text-left text-[15px] text-label-2 active:bg-raised"
		>
			<span className="truncate">{rowLabel(calls)}</span>
			<Stats added={stats.added} removed={stats.removed} className="ml-1" />
			{running ? (
				<Loader2 className="ml-0.5 size-4 flex-none animate-spin" aria-hidden="true" />
			) : (
				<ChevronRight className="ml-0.5 size-4 flex-none" aria-hidden="true" />
			)}
		</button>
	);
}

function Entry({ block, onOpenTools }: { block: Block; onOpenTools(calls: ToolCallView[]): void }): React.JSX.Element {
	switch (block.kind) {
		case "user":
			return <UserBubble text={block.text} />;
		case "assistant":
			return (
				<div>
					{block.thinking ? <Thinking text={block.thinking} /> : null}
					<Markdown text={block.text} className="prose-chat" />
				</div>
			);
		case "tools":
			return <ToolsRow calls={block.calls} onOpen={() => onOpenTools(block.calls)} />;
		case "note":
			return <p className="text-center text-[13px] text-label-3">{block.text}</p>;
	}
}

function DeleteSheet({
	open,
	onOpenChange,
	roomId,
}: {
	open: boolean;
	onOpenChange(open: boolean): void;
	roomId: string;
}): React.JSX.Element {
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string>();
	const remove = async (): Promise<void> => {
		setBusy(true);
		try {
			await deleteRoom(roomId);
			location.href = "/";
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
			setBusy(false);
		}
	};
	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				side="bottom"
				showCloseButton={false}
				className="glass-strong gap-0 rounded-t-[1.75rem] border-b-0 px-5 pt-6 text-label"
				style={{ paddingBottom: "calc(var(--safe-bottom) + 1.25rem)" }}
			>
				<SheetTitle className="text-[19px] font-semibold text-label">Delete this session?</SheetTitle>
				<SheetDescription className="mt-1 text-[15px] leading-relaxed text-label-2">
					The transcript stored on the relay is removed for good. The terminal, if it is still running, is not
					affected; it stops publishing.
				</SheetDescription>
				{error ? <p className="mt-3 text-[14px] text-danger">{error}</p> : null}
				<div className="mt-6 flex flex-col gap-2.5">
					<button
						type="button"
						disabled={busy}
						onClick={() => void remove()}
						className="rounded-2xl bg-danger px-5 py-3.5 font-semibold text-white transition active:scale-[0.985] disabled:opacity-50"
					>
						{busy ? "Deleting…" : "Delete"}
					</button>
					<button
						type="button"
						onClick={() => onOpenChange(false)}
						className="rounded-2xl bg-raised px-5 py-3.5 font-medium transition active:scale-[0.985] active:bg-raised-hover"
					>
						Cancel
					</button>
				</div>
			</SheetContent>
		</Sheet>
	);
}

/** "anthropic/claude-sonnet-5" reads as "claude-sonnet-5" in the bar; the provider is noise on a phone. */
function shortModel(model: string | undefined): string | undefined {
	return model?.split("/").at(-1) || undefined;
}

export function Room({ roomId }: { roomId: string }): React.JSX.Element {
	const { state, send, abort, dismissNotice } = useRoomSocket(roomId);

	const blocks = useMemo(() => toBlocks(state.entries), [state.entries]);
	const [draft, setDraft] = useState("");
	const [openCalls, setOpenCalls] = useState<ToolCallView[]>();
	const [confirmDelete, setConfirmDelete] = useState(false);
	const [atBottom, setAtBottom] = useState(true);
	const [bottomInset, setBottomInset] = useState(120);

	const scroller = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	const dock = useRef<HTMLDivElement>(null);
	const frame = useRef<HTMLDivElement>(null);
	const keyboard = useKeyboardFrame(frame);

	// The transcript's bottom padding follows the composer's real height, keyboard or not. Border box,
	// not contentRect: the dock's safe-area padding has to count or the last line ends under the composer.
	useLayoutEffect(() => {
		const node = dock.current;
		if (!node) return;
		const observer = new ResizeObserver(([entry]) => {
			const box = entry?.borderBoxSize[0];
			if (box) setBottomInset(box.blockSize);
		});
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	// Follow the tail the way a terminal does, but only while the reader is already there.
	useEffect(() => {
		const node = scroller.current;
		if (node && atBottom) node.scrollTop = node.scrollHeight;
	}, [blocks, state.liveText, state.liveThinking, state.streaming, atBottom, bottomInset, keyboard.inset]);

	const onScroll = (): void => {
		const node = scroller.current;
		if (!node) return;
		setAtBottom(node.scrollHeight - node.scrollTop - node.clientHeight < NEAR_BOTTOM_PX);
	};

	const jumpToBottom = (): void => {
		const node = scroller.current;
		if (node) node.scrollTo({ top: node.scrollHeight, behavior: "smooth" });
		setAtBottom(true);
	};

	const resize = (node: HTMLTextAreaElement): void => {
		node.style.height = "auto";
		node.style.height = `${Math.min(node.scrollHeight, MAX_DRAFT_HEIGHT_PX)}px`;
	};

	const submit = (): void => {
		const text = draft.trim();
		if (text.length === 0) return;
		if (!send(text)) return;
		setDraft("");
		if (input.current) input.current.style.height = "auto";
		setAtBottom(true);
	};

	const slash = /^\/(\S*)$/.exec(draft);
	const suggestions = useMemo(() => {
		if (!slash) return undefined;
		const prefix = (slash[1] ?? "").toLowerCase();
		return state.commands.filter((command) => command.name.toLowerCase().startsWith(prefix));
	}, [slash, state.commands]);

	const pick = (name: string): void => {
		setDraft(`/${name} `);
		const node = input.current;
		if (node) {
			focusWithoutPan(node);
			requestAnimationFrame(() => resize(node));
		}
	};

	// The chip toggles the leading slash. Pointer-down is swallowed so the keyboard stays up.
	const toggleSlash = (): void => {
		setDraft((current) => (current.startsWith("/") ? current.replace(/^\/\S*\s?/, "") : `/${current}`));
		const node = input.current;
		if (node) {
			focusWithoutPan(node);
			requestAnimationFrame(() => resize(node));
		}
	};

	const copyLink = (): void => {
		void navigator.clipboard?.writeText(location.href);
	};

	const lastBlock = blocks.at(-1);
	const toolRunning = lastBlock?.kind === "tools" && lastBlock.calls.some(isRunning);
	const showWorking =
		state.hostOnline &&
		state.streaming &&
		state.liveText === undefined &&
		state.liveThinking === undefined &&
		!toolRunning;
	const where = shortenPath(state.cwd);
	const model = shortModel(state.model);
	const subtitle =
		state.connection === "reconnecting" ? "Reconnecting…" : [where, model].filter(Boolean).join(" · ") || " ";
	// How far the dock rises to sit on the keyboard. The keyboard covers the home indicator, so the
	// dock's safe-area padding is given back as it rises; the transition runs about as long as iOS's.
	const lift =
		keyboard.inset > 0 ? `calc(${keyboard.inset}px + 0.5rem - max(0.75rem, var(--safe-bottom)))` : "0px";

	return (
		<div ref={frame} className="fixed inset-x-0 h-dvh overflow-hidden bg-ground" style={{ top: keyboard.top }}>
			<TopBar
				left={
					<GlassLink href="/" aria-label="Back to sessions">
						<ChevronLeft className="size-6" aria-hidden="true" />
					</GlassLink>
				}
				center={
					<div className="min-w-0">
						<h1 className="truncate text-[17px] leading-tight font-semibold">{state.sessionName ?? "Session"}</h1>
						<p className="truncate text-[13px] leading-tight text-label-2">{subtitle}</p>
					</div>
				}
				right={
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<GlassButton aria-label="More">
								<MoreHorizontal className="size-5" aria-hidden="true" />
							</GlassButton>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end" className="glass-strong min-w-48 rounded-2xl p-1.5 text-label">
							<DropdownMenuItem className="rounded-xl py-2.5 text-[15px]" onSelect={copyLink}>
								<Link2 aria-hidden="true" /> Copy link
							</DropdownMenuItem>
							<DropdownMenuItem
								variant="destructive"
								className="rounded-xl py-2.5 text-[15px]"
								onSelect={() => setConfirmDelete(true)}
							>
								<Trash2 aria-hidden="true" /> Delete session
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				}
			/>

			<div
				ref={scroller}
				onScroll={onScroll}
				className="h-full overflow-y-auto overscroll-contain"
				style={{
					paddingTop: "calc(var(--topbar) + var(--safe-top) + 1.25rem)",
					// Clears the 1.5rem fade above the composer, so the last line at rest is never dimmed.
					paddingBottom: `calc(${bottomInset}px + 1.5rem + ${lift})`,
				}}
			>
				<div className="mx-auto flex max-w-3xl flex-col gap-6 px-5">
					{blocks.length === 0 && !state.synced ? (
						<p className="pt-[30vh] text-center text-label-2">Loading the session…</p>
					) : null}
					{blocks.length === 0 && state.synced ? (
						<p className="pt-[30vh] text-center text-label-2">Nothing here yet.</p>
					) : null}
					{blocks.map((block) => (
						<Entry key={block.id} block={block} onOpenTools={setOpenCalls} />
					))}
					{state.liveText !== undefined || state.liveThinking !== undefined ? (
						<div>
							{state.liveThinking ? (
								<Thinking text={state.liveThinking} live={state.liveText === undefined} />
							) : null}
							{state.liveText !== undefined ? <Markdown text={state.liveText} className="prose-chat" /> : null}
						</div>
					) : null}
					{showWorking ? <p className="shimmer text-[15px] font-medium">Working…</p> : null}
				</div>
			</div>

			<div
				ref={dock}
				className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-3 transition-transform duration-500 ease-(--ease-emphasis)"
				style={{
					paddingBottom: "max(0.75rem, var(--safe-bottom))",
					transform: keyboard.inset > 0 ? `translateY(calc(-1 * ${lift}))` : undefined,
				}}
			>
				{/* Solid ground behind the composer so text never ghosts through the glass, dissolving over 1.5rem above it.
				    It runs on below the dock so the transcript does not show through a translucent keyboard either. */}
				<div
					aria-hidden="true"
					className="absolute inset-x-0 -top-6 -bottom-[100vh] bg-[linear-gradient(to_bottom,transparent,var(--ground)_1.5rem)]"
				/>

				<div className="relative mx-auto w-full max-w-3xl">
					{/* Out of flow, so showing it never changes the measured height and the transcript does not jump mid-scroll. */}
					{!atBottom ? (
						<div className="absolute inset-x-0 bottom-full mb-3 flex justify-center">
							<GlassButton
								aria-label="Jump to the latest"
								className="pointer-events-auto size-11"
								onClick={jumpToBottom}
							>
								<ArrowDown className="size-5" aria-hidden="true" />
							</GlassButton>
						</div>
					) : null}

					{state.synced && !state.hostOnline ? (
						<p className="glass rise-in pointer-events-auto w-full rounded-[1.5rem] px-5 py-4 text-center text-[15px] text-label-2">
							The terminal is offline. The transcript stays readable here.
						</p>
					) : (
						<div className="pointer-events-auto relative w-full">
							{suggestions ? (
								<div className="rise-in absolute inset-x-0 bottom-full mb-2">
									<CommandList commands={suggestions} onPick={pick} />
								</div>
							) : null}
							{state.notice ? (
								<button
									type="button"
									onClick={dismissNotice}
									className="rise-in mb-2 block w-full rounded-2xl bg-danger/15 px-4 py-2.5 text-left text-[14px] text-danger"
								>
									{state.notice}
								</button>
							) : null}
							<form
								className="glass flex flex-col rounded-[1.75rem] px-3 pt-1.5 pb-2.5"
								onSubmit={(event) => {
									event.preventDefault();
									submit();
								}}
							>
								<textarea
									ref={input}
									rows={1}
									value={draft}
									placeholder="Reply…"
									autoComplete="off"
									autoCorrect="on"
									enterKeyHint="send"
									className="max-h-40 w-full resize-none bg-transparent px-2 py-2.5 text-[17px] leading-relaxed text-label outline-none placeholder:text-label-3"
									onTouchEnd={(event) => {
										// A tap that opens the keyboard focuses through focusWithoutPan. Skipped mid-drag (the
										// event is no longer cancelable) and once focused, where a tap only moves the caret.
										if (!event.cancelable || event.currentTarget === document.activeElement) return;
										event.preventDefault();
										focusWithoutPan(event.currentTarget);
									}}
									onChange={(event) => {
										setDraft(event.target.value);
										resize(event.target);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
											event.preventDefault();
											submit();
										}
									}}
								/>
								<div className="mt-1 flex items-center justify-between">
									<button
										type="button"
										className="chip"
										aria-pressed={suggestions !== undefined}
										onPointerDown={(event) => event.preventDefault()}
										onClick={toggleSlash}
									>
										<span className="font-mono text-[15px]">/</span>
										Commands
									</button>
									<div className="flex items-center gap-2">
										{state.streaming ? (
											<button
												type="button"
												aria-label="Stop the current turn"
												onClick={abort}
												className="round-button bg-raised text-label active:bg-raised-hover"
											>
												<Square className="size-4 fill-current" aria-hidden="true" />
											</button>
										) : null}
										<button
											type="submit"
											aria-label="Send"
											disabled={draft.trim().length === 0}
											className="round-button bg-tint text-tint-ink disabled:bg-raised disabled:text-label-3"
										>
											<ArrowUp className="size-5" strokeWidth={2.25} aria-hidden="true" />
										</button>
									</div>
								</div>
							</form>
						</div>
					)}
				</div>
			</div>

			<ToolSheet calls={openCalls} onClose={() => setOpenCalls(undefined)} />
			<DeleteSheet open={confirmDelete} onOpenChange={setConfirmDelete} roomId={roomId} />
		</div>
	);
}
