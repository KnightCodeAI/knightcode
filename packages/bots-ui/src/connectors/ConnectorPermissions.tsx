// Per-connector permissions: reads, writes and each tool set to Auto review, Needs approval or Blocked. They feed the
// approval system.
import type { ConnectorPermissions as Permissions, PermissionLevel } from "@knightcode/bots-protocol";
import { Select } from "../primitives/Select.tsx";

const LEVELS: { value: PermissionLevel; label: string }[] = [
	{ value: "auto", label: "Auto review" },
	{ value: "approval", label: "Needs approval" },
	{ value: "blocked", label: "Blocked" },
];

/** Reads, writes, then any per-tool overrides. */
export function ConnectorPermissions({
	value,
	onChange,
}: {
	value: Permissions;
	onChange: (value: Permissions) => void;
}) {
	const row = (label: string, level: PermissionLevel, set: (level: PermissionLevel) => void) => (
		<li className="kb-group__row" key={label}>
			<span>{label}</span>
			<Select label={label} value={level} onValueChange={(next) => set(next as PermissionLevel)} options={LEVELS} />
		</li>
	);
	return (
		<ul className="kb-group__list kb-permissions">
			{row("Reads", value.reads, (reads) => onChange({ ...value, reads }))}
			{row("Writes", value.writes, (writes) => onChange({ ...value, writes }))}
			{Object.entries(value.tools).map(([tool, level]) =>
				row(tool, level, (next) => onChange({ ...value, tools: { ...value.tools, [tool]: next } })),
			)}
		</ul>
	);
}
