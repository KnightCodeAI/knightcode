import type { RemoteCommand } from "../../../../../packages/remote/src/protocol.ts";

/** The slash popover above the composer. Glass, because it floats over the transcript. */
export function CommandList({
	commands,
	onPick,
}: {
	commands: RemoteCommand[];
	onPick(name: string): void;
}): React.JSX.Element {
	return (
		<div className="glass max-h-72 overflow-y-auto rounded-[1.25rem] py-1" role="listbox" aria-label="Slash commands">
			{commands.length === 0 ? (
				<p className="px-4 py-3 text-[15px] text-label-2">No matching commands</p>
			) : (
				commands.map((command) => (
					<button
						key={command.name}
						type="button"
						role="option"
						aria-selected="false"
						className="flex w-full flex-col items-start gap-0.5 px-4 py-2.5 text-left active:bg-raised-hover"
						onPointerDown={(event) => event.preventDefault()}
						onClick={() => onPick(command.name)}
					>
						<span className="font-mono text-[15px] text-tint">/{command.name}</span>
						{command.description ? (
							<span className="line-clamp-1 text-[13px] text-label-2">{command.description}</span>
						) : null}
					</button>
				))
			)}
		</div>
	);
}
