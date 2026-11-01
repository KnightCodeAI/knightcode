// The message box: Enter sends (or steers a running reply), Shift+Enter breaks the line, Stop ends a run.
import { ArrowUp, Plus, Slash, Square } from "lucide-react";
import { type KeyboardEvent, type ReactNode, useState } from "react";

export interface ComposerProps {
	placeholder: string;
	running: boolean;
	onSend: (text: string) => void;
	onStop: () => void;
	/** The leading "+" control (attachments, skills); a plain button until the chat task fills it. */
	leading?: ReactNode;
	/** Content above the text, such as attachments and suggestion lists. */
	children?: ReactNode;
	value?: string;
	onValueChange?: (value: string) => void;
	onKeyDownCapture?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean | void;
	/** Opens the skills list, as typing "/" does. */
	onSkills?: () => void;
}

/** The composer at the foot of a chat. */
export function Composer({
	placeholder,
	running,
	onSend,
	onStop,
	leading,
	children,
	value,
	onValueChange,
	onKeyDownCapture,
	onSkills,
}: ComposerProps) {
	const [own, setOwn] = useState("");
	const text = value ?? own;
	const setText = onValueChange ?? setOwn;
	const send = () => {
		const trimmed = text.trim();
		if (!trimmed) return;
		onSend(trimmed);
		setText("");
	};
	return (
		<div className="kb-composer-dock" data-ref="composer-dock">
			<form
				className="kb-composer"
				data-ref="composer"
				onSubmit={(event) => {
					event.preventDefault();
					send();
				}}
			>
				{children}
				<div className="kb-composer__pad">
					<textarea
						className="kb-composer__field"
						data-ref="prompt-field"
						aria-label="Message"
						placeholder={placeholder}
						rows={1}
						value={text}
						onChange={(event) => setText(event.target.value)}
						onKeyDown={(event) => {
							if (onKeyDownCapture?.(event) === true) return;
							if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
								event.preventDefault();
								send();
							}
						}}
					/>
				</div>
				<div className="kb-composer__leading">
					{leading ?? (
						<button
							type="button"
							className="kb-composer-button"
							aria-label="Composer actions"
							data-ref="composer-actions"
						>
							<Plus size={16} strokeWidth={1.75} />
						</button>
					)}
				</div>
				<div className="kb-composer__trailing">
					<button
						type="button"
						className="kb-composer-button"
						aria-label="Run a skill"
						data-ref="voice-input"
						onClick={onSkills}
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
							disabled={!text.trim()}
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
