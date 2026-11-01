// Types a secret into the focused field on the bot's screen without it ever reaching the chat or the transcript.
import { KeyRound } from "lucide-react";
import { useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { useStore } from "../state/store.ts";

/** The field clears as soon as the value is sent. */
export function ProtectedInput({ botId }: { botId: string }) {
	const store = useStore();
	const [value, setValue] = useState("");
	const [sent, setSent] = useState(false);
	return (
		<form
			className="kb-protected"
			onSubmit={(event) => {
				event.preventDefault();
				if (!value) return;
				const secret = value;
				setValue("");
				void store.api.protectedInput({ botId, value: secret }).then(() => {
					setSent(true);
					setTimeout(() => setSent(false), 1500);
				});
			}}
		>
			<KeyRound size={14} className="kb-protected__icon" aria-hidden />
			<Input
				type="password"
				autoComplete="off"
				aria-label="Type a password into the screen"
				placeholder={sent ? "Typed into the screen" : "Type a password into the screen"}
				value={value}
				onChange={(event) => setValue(event.target.value)}
			/>
			<Button variant="secondary" size="sm" type="submit" disabled={!value}>
				Type it
			</Button>
		</form>
	);
}
