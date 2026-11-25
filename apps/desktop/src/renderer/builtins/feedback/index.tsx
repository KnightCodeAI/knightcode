/** Built-in feedback: the newest three toasts under the title bar, and the zoom level after a zoom change. */
import { useEffect, useRef, useState } from "react";
import {
	defineDesktopExtension,
	experimental_Button as Button,
	experimental_controllers,
	experimental_controls,
	experimental_Icon as Icon,
	type experimental_IconName,
	experimental_useToasts,
	experimental_useZoom,
} from "@knightcodeai/cli/desktop";

const TOAST_MARKS = { success: "CircleCheck", error: "CircleAlert", info: "Info" } satisfies Record<
	string,
	experimental_IconName
>;

function Toasts() {
	const toasts = experimental_useToasts();
	return (
		<div
			role="status"
			aria-label="Notifications"
			className="pointer-events-none fixed inset-x-0 top-12 z-[60] flex flex-col items-center gap-2 px-2"
		>
			{toasts.slice(-3).map((t) => (
				<div key={t.id} data-kind={t.kind} className="kc-toast max-w-[min(560px,100%)]">
					<Icon name={TOAST_MARKS[t.kind]} size={16} className="shrink-0" />
					<span className="min-w-0 [overflow-wrap:anywhere]">{t.text}</span>
					<Button
						size="xs"
						uniform
						pill
						aria-label="Close"
						onClick={() => experimental_controllers().experimental_dismissToast(t.id)}
						className="text-current"
					>
						<Icon name="X" size={16} />
					</Button>
				</div>
			))}
		</div>
	);
}

const zoomCommand = (command: "zoomIn" | "zoomOut" | "resetZoom") =>
	void experimental_controllers().experimental_windowCommand(command);

/**
 * Codex's zoom banner: the level after a zoom, top right beside the caption buttons (8px down, 16px in), with
 * steppers and Reset. It leaves 2s after the last change unless the pointer is on it. Electron zooms the page itself,
 * so the pill undoes the zoom to stay Codex's size.
 */
function ZoomBanner() {
	const { factor, changes } = experimental_useZoom();
	const { experimental_IconButton: IconButton } = experimental_controls();
	const [shown, setShown] = useState<"hidden" | "visible" | "exiting">("hidden");
	const timer = useRef<number | undefined>(undefined);
	const hovered = useRef(false);
	const hide = () => {
		window.clearTimeout(timer.current);
		setShown("exiting");
		timer.current = window.setTimeout(() => setShown("hidden"), 150);
	};
	useEffect(() => {
		// Mounting is not a zoom change: a remounted presenter stays hidden until the next one.
		if (changes === 0) return;
		setShown("visible");
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => {
			timer.current = undefined;
			if (!hovered.current) hide();
		}, 2000);
	}, [changes]);
	useEffect(() => () => window.clearTimeout(timer.current), []);
	if (shown === "hidden") return null;
	return (
		<div
			className={`pointer-events-none fixed top-0 z-[56] transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none ${shown === "visible" ? "" : "-translate-y-1 opacity-0"}`}
			style={{ right: "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, 100vw))" }}
		>
			<div
				className="kc-zoom-banner no-drag pointer-events-auto mt-2 me-4 inline-flex h-11 items-center overflow-hidden rounded-[20px] border-[0.5px] border-line bg-surface-secondary px-2 shadow-[0px_8px_16px_-4px_rgba(0,0,0,0.12)]"
				style={{ zoom: 1 / factor }}
				onMouseEnter={() => (hovered.current = true)}
				onMouseLeave={() => {
					hovered.current = false;
					if (shown === "visible" && timer.current === undefined) hide();
				}}
			>
				<span aria-live="polite" className="w-12 text-center text-sm font-semibold text-ink tabular-nums">
					{Math.round(factor * 100)}%
				</span>
				<div className="ms-1 flex items-center">
					<IconButton label="Zoom out" toolbar onClick={() => zoomCommand("zoomOut")}>
						<Icon name="Minus" size={16} />
					</IconButton>
					<IconButton label="Zoom in" toolbar onClick={() => zoomCommand("zoomIn")}>
						<Icon name="Plus" size={16} />
					</IconButton>
				</div>
				<div className="mx-1 h-4 w-px bg-line" />
				<Button color="secondary" toolbar disabled={factor === 1} onClick={() => zoomCommand("resetZoom")}>
					Reset
				</Button>
			</div>
		</div>
	);
}

function Feedback() {
	return (
		<>
			<Toasts />
			<ZoomBanner />
		</>
	);
}

export default defineDesktopExtension((app) => {
	app.experimental_registerProvider({ id: "toasts", surface: "feedback", experimental_render: Feedback });
});
