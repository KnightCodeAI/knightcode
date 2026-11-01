// Maintenance: Stop, Update, Recover and Reset run as durable jobs that hold off new runs and show progress; Reset
// asks first, since it drops unsaved changes. The setup script (extra system packages) is edited here too.
import type { ComputerState } from "@knightcode/bots-protocol";
import { FileCode2, MoreHorizontal, Power, RefreshCw, RotateCcw, Wrench } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Textarea } from "../primitives/Input.tsx";
import { Menu, MenuItem, MenuSeparator } from "../primitives/Menu.tsx";
import { COMPUTER, useStore } from "../state/store.ts";
import { formatDay, formatTime } from "../chat/layout.ts";

type Action = NonNullable<ComputerState["job"]>["action"];

/** The "More computer actions" menu and its two dialogs. */
export function Maintenance({ computer }: { computer: ComputerState | undefined }) {
	const store = useStore();
	const [confirmReset, setConfirmReset] = useState(false);
	const [script, setScript] = useState<string>();
	const busy = computer?.status === "maintenance";
	const run = async (action: Action) => {
		const next = await store.api.runMaintenance({ action });
		store.set(COMPUTER, () => next);
	};
	return (
		<>
			<Menu
				label="More computer actions"
				align="end"
				trigger={
					<button type="button" className="kb-screen__tool" aria-label="More computer actions">
						<MoreHorizontal size={16} strokeWidth={1.75} />
					</button>
				}
			>
				<MenuItem icon={<Power size={14} />} disabled={busy} onSelect={() => void run("stop")}>
					Stop computer
				</MenuItem>
				<MenuItem icon={<RefreshCw size={14} />} disabled={busy} onSelect={() => void run("update")}>
					Update computer
				</MenuItem>
				<MenuItem icon={<Wrench size={14} />} disabled={busy} onSelect={() => void run("recover")}>
					Recover computer
				</MenuItem>
				<MenuItem icon={<RotateCcw size={14} />} disabled={busy} onSelect={() => setConfirmReset(true)}>
					Reset computer
				</MenuItem>
				<MenuSeparator />
				<MenuItem
					icon={<FileCode2 size={14} />}
					onSelect={() => void store.api.getSetupScript({}).then((result) => setScript(result.script))}
				>
					Setup script
				</MenuItem>
			</Menu>
			{confirmReset && (
				<Dialog
					open
					onOpenChange={(open) => !open && setConfirmReset(false)}
					title="Reset computer?"
					width={420}
					footer={
						<>
							<Button variant="secondary" onClick={() => setConfirmReset(false)}>
								Cancel
							</Button>
							<Button
								variant="primary"
								onClick={() => {
									setConfirmReset(false);
									void run("reset");
								}}
							>
								Reset
							</Button>
						</>
					}
				>
					<p className="kb-dialog__body kb-dialog__text">
						The computer goes back to its last save
						{computer?.lastSavedAt ? ` (${formatDay(computer.lastSavedAt)} ${formatTime(computer.lastSavedAt)})` : ""}.
						Anything changed since then is lost.
					</p>
				</Dialog>
			)}
			{script !== undefined && <SetupScript initial={script} onClose={() => setScript(undefined)} />}
		</>
	);
}

function SetupScript({ initial, onClose }: { initial: string; onClose: () => void }) {
	const store = useStore();
	const [text, setText] = useState(initial);
	useEffect(() => setText(initial), [initial]);
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Setup script"
			width={520}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" onClick={() => void store.api.putSetupScript({ script: text }).then(onClose)}>
						Save
					</Button>
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<p className="kb-settings__hint">
					Runs on every fresh computer and every rebuild, for system packages that saves do not keep.
				</p>
				<Textarea
					aria-label="Setup script"
					className="kb-code"
					rows={10}
					value={text}
					spellCheck={false}
					onChange={(e) => setText(e.target.value)}
				/>
			</div>
		</Dialog>
	);
}
