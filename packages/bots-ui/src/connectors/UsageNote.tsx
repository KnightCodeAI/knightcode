// A connector's usage note: a short instruction (at most 500 characters) the bot always follows with that app.
import { Textarea } from "../primitives/Input.tsx";

export const USAGE_NOTE_MAX = 500;

/** The field, with a count and an error past the limit. */
export function UsageNote({
	value,
	onChange,
	onBlur,
}: {
	value: string;
	onChange: (value: string) => void;
	onBlur?: () => void;
}) {
	const over = value.length > USAGE_NOTE_MAX;
	return (
		<div className="kb-usage-note">
			<Textarea
				aria-label="Usage note"
				placeholder='For example: "Always draft, never send."'
				rows={3}
				value={value}
				aria-invalid={over || undefined}
				onChange={(event) => onChange(event.target.value)}
				onBlur={onBlur}
			/>
			<p
				className={over ? "kb-usage-note__count kb-usage-note__count--over" : "kb-usage-note__count"}
				role={over ? "alert" : undefined}
			>
				{over ? `Keep it to ${USAGE_NOTE_MAX} characters` : `${value.length}/${USAGE_NOTE_MAX}`}
			</p>
		</div>
	);
}
