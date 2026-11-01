// Keyboard shortcuts, opened from the search palette's Help row.
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";

const SHORTCUTS: [string, string][] = [
	[`${MOD} K`, "Search bots, chats, pages and settings"],
	["Enter", "Send the message"],
	["Shift Enter", "New line in the message"],
	["@", "Mention a bot or an app"],
	["/", "Run a skill"],
	["Escape", "Close a dialog or menu"],
];

export function Shortcuts({ onClose }: { onClose: () => void }) {
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Keyboard shortcuts"
			width={420}
			footer={
				<Button variant="primary" onClick={onClose}>
					Done
				</Button>
			}
		>
			<dl className="kb-dialog__body kb-shortcuts">
				{SHORTCUTS.map(([keys, what]) => (
					<div key={keys} className="kb-shortcuts__row">
						<dt>
							{keys.split(" ").map((key) => (
								<kbd key={key}>{key}</kbd>
							))}
						</dt>
						<dd>{what}</dd>
					</div>
				))}
			</dl>
		</Dialog>
	);
}
