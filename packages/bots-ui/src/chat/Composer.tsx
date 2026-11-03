// The message box: Enter sends (or steers a running reply), Shift+Enter breaks the line, Stop ends a run. Typing "@"
// lists what can be mentioned, "/" lists skills, and files attach from the "+" menu or by dropping them.
import { ArrowUp, FileText, Paperclip, Plus, Slash, Square, X } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu, MenuItem } from "../primitives/Menu.tsx";

/** Something the "@" or "/" list offers. */
export interface Suggestion {
	id: string;
	label: string;
	detail?: string;
	kind: string;
	icon?: ReactNode;
	/** What replaces the typed "@query" or "/query". */
	insert: string;
}

export interface Draft {
	files: File[];
	replyTo?: { id: string; text: string };
	quote?: string;
}

export interface ComposerProps {
	placeholder: string;
	running: boolean;
	onSend: (text: string, draft: Draft) => void;
	onStop: () => void;
	mentions: Suggestion[];
	skills: Suggestion[];
	/** Set from outside (Reply, Quote): merged into the draft. */
	context?: { replyTo?: { id: string; text: string }; quote?: string; nonce: number };
	/** Opens Teach a task on the bot's computer; a group chat has none. */
	onTeach?: () => void;
	/** Called on every keystroke in the message box. */
	onType?: () => void;
}

type Trigger = { char: "@" | "/"; start: number; query: string };

/** The composer at the foot of a chat. */
export function Composer({
	placeholder,
	running,
	onSend,
	onStop,
	mentions,
	skills,
	context,
	onTeach,
	onType,
}: ComposerProps) {
	const [text, setText] = useState("");
	const [files, setFiles] = useState<File[]>([]);
	const [replyTo, setReplyTo] = useState<Draft["replyTo"]>();
	const [quote, setQuote] = useState<string>();
	const [caret, setCaret] = useState(0);
	const [selected, setSelected] = useState(0);
	const [dismissed, setDismissed] = useState<number | undefined>();
	const field = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const form = useRef<HTMLFormElement>(null);
	const surface = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!context) return;
		if (context.replyTo) setReplyTo(context.replyTo);
		if (context.quote) setQuote(context.quote);
		field.current?.focus();
	}, [context]);

	const trigger = useMemo(() => findTrigger(text, caret), [text, caret]);
	const open = trigger && trigger.start !== dismissed ? trigger : undefined;
	const options = useMemo(() => {
		if (!open) return [];
		const pool = open.char === "@" ? mentions : skills;
		const needle = open.query.toLowerCase();
		return pool.filter((s) => s.label.toLowerCase().includes(needle)).slice(0, 8);
	}, [open, mentions, skills]);
	useEffect(() => setSelected(0), [open?.char, open?.query]);

	const insertAtCaret = (value: string) => {
		const position = field.current?.selectionStart ?? text.length;
		setText(`${text.slice(0, position)}${value}${text.slice(position)}`);
		setCaret(position + value.length);
		requestAnimationFrame(() => {
			field.current?.focus();
			field.current?.setSelectionRange(position + value.length, position + value.length);
		});
	};
	const pick = (option: Suggestion) => {
		if (!open) return;
		const before = text.slice(0, open.start);
		const after = text.slice(caret).replace(/^\s/, "");
		const position = before.length + option.insert.length + 1;
		setText(`${before}${option.insert} ${after}`);
		setCaret(position);
		requestAnimationFrame(() => {
			field.current?.focus();
			field.current?.setSelectionRange(position, position);
		});
	};
	const send = () => {
		const trimmed = text.trim();
		if (!trimmed && files.length === 0) return;
		onSend(trimmed, { files, replyTo, quote });
		setText("");
		setFiles([]);
		setReplyTo(undefined);
		setQuote(undefined);
	};
	const addFiles = (list: FileList | null) => {
		if (!list) return;
		// FileList is live: the input resets before React may run the state updater.
		const added = Array.from(list);
		setFiles((current) => [...current, ...added]);
	};
	const listName = open?.char === "@" ? "Mentions" : "Skills";

	// The list lives in the top layer, above everything, anchored to the composer's top-left corner on whole pixels.
	const listOpen = open !== undefined;
	useLayoutEffect(() => {
		const element = surface.current;
		const anchor = form.current;
		if (!listOpen || !element || !anchor) return;
		const place = () => {
			const rect = anchor.getBoundingClientRect();
			element.style.left = `${Math.round(rect.left + 28)}px`;
			element.style.bottom = `${window.innerHeight - Math.round(rect.top + 7)}px`;
		};
		place();
		if (!element.matches(":popover-open")) element.showPopover?.();
		window.addEventListener("resize", place);
		return () => window.removeEventListener("resize", place);
	}, [listOpen]);

	return (
		<div className="kb-composer-dock" data-ref="composer-dock">
			<form
				ref={form}
				className="kb-composer"
				data-ref="composer"
				onSubmit={(event) => {
					event.preventDefault();
					send();
				}}
				onDragOver={(event) => event.preventDefault()}
				onDrop={(event) => {
					event.preventDefault();
					addFiles(event.dataTransfer.files);
				}}
			>
				{open && (
					<div ref={surface} className="kb-floating kb-suggest" popover="manual">
						<ul className="kb-suggest__list" role="listbox" aria-label={listName} data-ref="popover">
							{options.length === 0 && (
								<li className="kb-suggest__empty">{open.char === "@" ? "Nothing to mention" : "No skills yet"}</li>
							)}
							{options.map((option, i) => (
								<li key={option.id} role="presentation">
									<button
										type="button"
										role="option"
										aria-selected={i === selected}
										className="kb-suggest__item"
										data-ref={i === 0 ? "popover-item" : undefined}
										onMouseEnter={() => setSelected(i)}
										onMouseDown={(event) => event.preventDefault()}
										onClick={() => pick(option)}
									>
										<span className="kb-suggest__icon">{option.icon}</span>
										<span className="kb-suggest__text">
											<span>{option.label}</span>
											{option.detail && <span className="kb-suggest__detail">{option.detail}</span>}
										</span>
										<span className="kb-suggest__kind">{option.kind}</span>
									</button>
								</li>
							))}
						</ul>
					</div>
				)}
				{(replyTo || quote || files.length > 0) && (
					<div className="kb-composer__context">
						{replyTo && <Chip label={`Replying to: ${replyTo.text}`} onRemove={() => setReplyTo(undefined)} />}
						{quote && <Chip label={`“${quote}”`} onRemove={() => setQuote(undefined)} />}
						{files.map((file, i) => (
							<Chip
								key={`${file.name}-${i}`}
								testId="attachment"
								icon={<FileText size={12} />}
								label={file.name}
								onRemove={() => setFiles((current) => current.filter((_, j) => j !== i))}
							/>
						))}
					</div>
				)}
				<div className="kb-composer__pad">
					<textarea
						ref={field}
						className="kb-composer__field"
						data-ref="prompt-field"
						aria-label="Message"
						aria-autocomplete="list"
						aria-expanded={Boolean(open)}
						placeholder={placeholder}
						rows={1}
						value={text}
						onChange={(event) => {
							setText(event.target.value);
							setCaret(event.target.selectionStart);
							setDismissed(undefined);
							onType?.();
						}}
						onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
						onPaste={(event) => {
							if (event.clipboardData.files.length === 0) return;
							event.preventDefault();
							addFiles(event.clipboardData.files);
						}}
						onKeyDown={(event) => {
							if (open && options.length > 0) {
								if (event.key === "ArrowDown" || event.key === "ArrowUp") {
									event.preventDefault();
									const step = event.key === "ArrowDown" ? 1 : -1;
									setSelected((i) => (i + step + options.length) % options.length);
									return;
								}
								if (event.key === "Enter" || event.key === "Tab") {
									event.preventDefault();
									pick(options[selected]!);
									return;
								}
							}
							if (open && event.key === "Escape") {
								event.preventDefault();
								setDismissed(open.start);
								return;
							}
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								send();
							}
						}}
					/>
				</div>
				<div className="kb-composer__leading">
					<Menu
						label="Composer actions"
						side="top"
						trigger={
							<button
								type="button"
								className="kb-composer-button"
								aria-label="Composer actions"
								data-ref="composer-actions"
							>
								<Plus size={16} strokeWidth={1.75} />
							</button>
						}
					>
						<MenuItem icon={<Paperclip size={14} />} onSelect={() => fileInput.current?.click()}>
							Attach files
						</MenuItem>
						{onTeach && (
							<MenuItem icon={<RecordMark />} onSelect={onTeach}>
								Teach a task
							</MenuItem>
						)}
					</Menu>
					<input
						ref={fileInput}
						type="file"
						multiple
						hidden
						onChange={(event) => {
							addFiles(event.target.files);
							event.target.value = "";
						}}
					/>
				</div>
				<div className="kb-composer__trailing">
					<button
						type="button"
						className="kb-composer-button"
						aria-label="Run a skill"
						data-ref="voice-input"
						onClick={() => insertAtCaret("/")}
					>
						<Slash size={14} strokeWidth={2} />
					</button>
					{running ? (
						<button
							type="button"
							className="kb-composer-button kb-composer-button--primary"
							aria-label="Stop"
							onClick={onStop}
						>
							<Square size={10} fill="currentColor" strokeWidth={0} />
						</button>
					) : (
						<button
							type="submit"
							className="kb-composer-button kb-composer-button--primary"
							aria-label="Send"
							disabled={!text.trim() && files.length === 0}
							data-ref="voice-chat"
						>
							<ArrowUp size={16} strokeWidth={2} />
						</button>
					)}
				</div>
			</form>
		</div>
	);
}

/** The "@query" or "/query" the caret sits at the end of, if any. "/" counts only at the start of the message. */
export function findTrigger(text: string, caret: number): Trigger | undefined {
	const before = text.slice(0, caret);
	const mention = /(^|\s)@([^\s@]*)$/.exec(before);
	if (mention) return { char: "@", start: before.length - mention[2]!.length - 1, query: mention[2]! };
	const skill = /^\/([^\s/]*)$/.exec(before);
	if (skill) return { char: "/", start: 0, query: skill[1]! };
	return undefined;
}

function Chip({
	label,
	icon,
	onRemove,
	testId,
}: {
	label: string;
	icon?: ReactNode;
	onRemove: () => void;
	testId?: string;
}) {
	return (
		<span className="kb-chip" data-testid={testId}>
			{icon}
			<span className="kb-chip__label">{label}</span>
			<button type="button" className="kb-chip__remove" aria-label={`Remove ${label}`} onClick={onRemove}>
				<X size={12} />
			</button>
		</span>
	);
}

/** Teach a task's mark: a record button, a solid dot in a ring. */
function RecordMark() {
	return (
		<svg width={14} height={14} viewBox="0 0 14 14" className="kb-record-icon" aria-hidden>
			<circle cx={7} cy={7} r={5.75} fill="none" stroke="currentColor" strokeWidth={1.5} />
			<circle cx={7} cy={7} r={3.5} fill="currentColor" />
		</svg>
	);
}
