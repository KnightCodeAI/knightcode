// A bot's screen: the noVNC page behind a short-lived capability URL, in view or control mode. Without a URL (the
// computer is asleep, waking, saving or under maintenance) the frame shows what it is doing.
import type { ComputerState } from "@knightcode/bots-protocol";
import type { ReactNode } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";

export interface ScreenViewerProps {
	/** The capability URL from the API; view and control are separate capabilities. */
	capabilityUrl?: string;
	mode: "view" | "control";
	/** Shown in the frame while there is no screen. */
	status?: ReactNode;
	/** Controls laid over the frame. */
	children?: ReactNode;
	title?: string;
}

/** The 16:10 frame. Control mode lets keyboard and pointer reach the computer; view mode does not. */
export function ScreenViewer({ capabilityUrl, mode, status, children, title = "Screen" }: ScreenViewerProps) {
	return (
		<div className="kb-screen" data-mode={mode} data-ref="screen-viewer">
			{capabilityUrl ? (
				<iframe
					className="kb-screen__frame"
					src={capabilityUrl}
					title={title}
					// The screen page runs noVNC; it is served from the screen origin, never the app's.
					sandbox="allow-scripts allow-same-origin allow-pointer-lock"
					allow="clipboard-write"
					referrerPolicy="no-referrer"
					tabIndex={mode === "control" ? 0 : -1}
					style={{ pointerEvents: mode === "control" ? "auto" : "none" }}
				/>
			) : (
				<div className="kb-screen__status">{status}</div>
			)}
			{children}
		</div>
	);
}

const LABELS: Record<ComputerState["status"], string> = {
	off: "Asleep",
	starting: "Waking up…",
	awake: "Connecting…",
	saving: "Saving…",
	sleeping: "Going to sleep…",
	restoring: "Restoring…",
	maintenance: "Working on it…",
	error: "Something went wrong",
};

const JOB_LABELS: Record<NonNullable<ComputerState["job"]>["action"], string> = {
	stop: "Stopping",
	update: "Updating",
	recover: "Recovering",
	reset: "Resetting",
};

/** The mark and a line about the computer's state; busy states shimmer. */
export function ScreenStatus({ computer }: { computer: ComputerState | undefined }) {
	const status = computer?.status ?? "starting";
	const job = computer?.job;
	const label = job ? `${JOB_LABELS[job.action]}… ${Math.round(job.progress * 100)}%` : LABELS[status];
	const busy = status !== "off" && status !== "error";
	return (
		<>
			<span className="kb-screen__mark">
				<BotAvatarView shape="blob" color="gray" state={status === "off" ? "sleeping" : "idle"} size={32} />
			</span>
			<span className="kb-screen__label">
				<span className={busy ? "kb-shimmer" : undefined} role="status">
					{label}
				</span>
			</span>
			{status === "error" && <span className="kb-screen__hint">Recover it from More computer actions.</span>}
		</>
	);
}
