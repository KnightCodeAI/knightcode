// The Computer tab: the bot's screen with its tools on hover (take control, teach, terminal, files, maintenance),
// and the caption under it. ?control=1 (from a takeover card) asks for control; ?teach=1 opens teaching.
import type { Bot } from "@knightcode/bots-protocol";
import { FolderOpen, GraduationCap, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { COMPUTER, useResource, useStore } from "../state/store.ts";
import { FilesDock } from "./FilesDock.tsx";
import { Maintenance } from "./Maintenance.tsx";
import { ScreenStatus, ScreenViewer } from "./ScreenViewer.tsx";
import { ControlBanner, TakeControlButton } from "./TakeControl.tsx";
import { TeachTask } from "./TeachTask.tsx";
import { TerminalDock } from "./TerminalDock.tsx";

type Dock = "terminal" | "files" | "teach";

/** The panel content of the Computer tab. */
export function ComputerPane({ bot }: { bot: Bot }) {
	const store = useStore();
	const { data: computer } = useResource(COMPUTER, (api) => api.getComputer({}));
	const askControl = useQueryParam("control") !== null;
	const askTeach = useQueryParam("teach") !== null;
	const [dock, setDock] = useState<Dock | undefined>(askTeach ? "teach" : undefined);
	const controlling = computer?.screens.some((s) => s.botId === bot.id && s.controller === "user") ?? false;
	const awake = computer?.status === "awake";
	const url = useCapability(bot.id, awake ? (controlling ? "control" : "view") : undefined);

	const take = async (on: boolean) => {
		const next = await store.api.setControl({ botId: bot.id, take: on });
		store.set(COMPUTER, () => next);
		if (!on && askControl) navigate({ name: "bot", botId: bot.id, pane: "computer" }, { replace: true });
	};
	// Arriving with ?control=1 asks for control once, as soon as the computer's state is known.
	const asked = useRef(false);
	useEffect(() => {
		if (!askControl) asked.current = false;
		else if (computer && !asked.current) {
			asked.current = true;
			if (!controlling) void take(true);
		}
	});
	useEffect(() => {
		if (askTeach) setDock("teach");
	}, [askTeach]);
	const toggle = (next: Dock) => setDock((current) => (current === next ? undefined : next));

	return (
		<div className="kb-computer" role="region" aria-label="Computer preview">
			<div className="kb-computer__preview">
				<ScreenViewer
					capabilityUrl={url}
					mode={controlling ? "control" : "view"}
					status={<ScreenStatus computer={computer} />}
					title={`${bot.name}'s screen`}
				>
					<div className="kb-screen__tools" role="toolbar" aria-label="Computer tools">
						{!controlling && <TakeControlButton onTake={() => void take(true)} />}
						<button
							type="button"
							className="kb-screen__tool"
							aria-label="Teach a task"
							aria-pressed={dock === "teach"}
							onClick={() => toggle("teach")}
						>
							<GraduationCap size={16} strokeWidth={1.75} />
						</button>
						<button
							type="button"
							className="kb-screen__tool"
							aria-label="Terminal"
							aria-pressed={dock === "terminal"}
							onClick={() => toggle("terminal")}
						>
							<SquareTerminal size={16} strokeWidth={1.75} />
						</button>
						<button
							type="button"
							className="kb-screen__tool"
							aria-label="Files"
							aria-pressed={dock === "files"}
							onClick={() => toggle("files")}
						>
							<FolderOpen size={16} strokeWidth={1.75} />
						</button>
						<Maintenance computer={computer} />
					</div>
				</ScreenViewer>
				<span className="kb-computer__caption">
					<span>{bot.name}'s screen</span>
				</span>
			</div>
			{controlling && <ControlBanner botId={bot.id} onRelease={() => void take(false)} />}
			{dock === "teach" && <TeachTask botId={bot.id} onTake={take} onClose={() => setDock(undefined)} />}
			{dock === "terminal" && (
				<TerminalDock
					botId={bot.id}
					controlling={controlling}
					onTake={() => void take(true)}
					onClose={() => setDock(undefined)}
				/>
			)}
			{dock === "files" && <FilesDock botId={bot.id} onClose={() => setDock(undefined)} />}
		</div>
	);
}

/** The screen capability for `mode`, renewed shortly before it expires; undefined while the computer is not awake. */
function useCapability(botId: string, mode: "view" | "control" | undefined): string | undefined {
	const store = useStore();
	const [url, setUrl] = useState<string>();
	useEffect(() => {
		if (!mode) return setUrl(undefined);
		let live = true;
		let timer: ReturnType<typeof setTimeout> | undefined;
		const fetchUrl = async () => {
			const result = await store.api.getScreen({ botId, mode });
			if (!live) return;
			setUrl(result.url);
			if (result.expiresAt)
				timer = setTimeout(() => void fetchUrl(), Math.max(5_000, result.expiresAt - Date.now() - 10_000));
		};
		void fetchUrl();
		return () => {
			live = false;
			clearTimeout(timer);
		};
	}, [store, botId, mode]);
	return url;
}
