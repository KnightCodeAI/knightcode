/**
 * The new-thread screen (desktop-shell.md section 9.12), as Codex's home (measured 2026-10-19): the mark, faint and
 * large, over "What should we build in ‹project›?" (28px; the project's name opens the project picker). The mark and
 * title share the centre of the space above the bottom composer. Setup cards join that group; in a short window,
 * the group scrolls while the composer stays on screen.
 */

import { lazy, type ReactNode, Suspense, useEffect, useState } from "react";
import { client } from "../client.ts";
import { basename } from "../format.ts";
import { addProject, errorText, navigate, selectProjects, showNew, toast, useStore } from "../store.ts";
import { Button } from "./button.tsx";
import { Composer } from "./composer.tsx";
import { ProjectPicker } from "./composer-pickers.tsx";
import { FolderPlus, KnightMark, LogIn, ShieldAlert } from "./icons.tsx";

/** A prompt card above the title: sign in, add a folder, trust the project. `onLater` adds "Not now". */
function SetupCard({
	icon,
	title,
	detail,
	action,
	onAction,
	onLater,
}: {
	icon: ReactNode;
	title: string;
	detail: string;
	action: string;
	onAction: () => void;
	onLater?: () => void;
}) {
	return (
		// Narrow, the buttons wrap under the text rather than squeeze it.
		<div className="flex w-full flex-wrap items-center gap-3 rounded-2xl bg-soft-alt px-4 py-3 shadow-[0_0_0_0.5px_var(--kc-border)]">
			<span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-surface-secondary text-secondary">
				{icon}
			</span>
			<div className="min-w-40 flex-1">
				<div className="text-base text-ink">{title}</div>
				<div className="text-sm text-tertiary">{detail}</div>
			</div>
			<div className="ml-auto flex shrink-0 gap-2">
				{onLater ? (
					<Button size="lg" squircle className="px-4" onClick={onLater}>
						Not now
					</Button>
				) : null}
				<Button variant="solid" size="lg" squircle className="px-4" onClick={onAction}>
					{action}
				</Button>
			</div>
		</div>
	);
}

/** Projects whose trust question was put off: asked again at the next launch. */
const later = new Set<string>();

/**
 * The trust question before a project's first thread, for a project with its own extensions or settings and no saved
 * decision. The answer goes to the trust store the terminal's `/trust` uses; until trusted, threads load without them.
 */
function TrustCard({ cwd }: { cwd: string }) {
	const [asking, setAsking] = useState(false);
	useEffect(() => {
		setAsking(false);
		if (later.has(cwd)) return;
		let current = true;
		// Unanswered, the project stays as it is; Settings › Configuration can still trust it.
		void client
			.request("project/trust/read", { cwd })
			.then((r) => current && setAsking(r.needsTrust && r.trusted === null))
			.catch(() => {});
		return () => {
			current = false;
		};
	}, [cwd]);
	return asking ? (
		<SetupCard
			icon={<ShieldAlert size={16} />}
			title="This project has its own extensions and settings. Trust it?"
			detail="Trusted, its extensions can run code on this computer."
			action="Trust"
			onAction={() =>
				void client
					.request("project/trust/set", { cwd, trusted: true })
					.then(() => setAsking(false))
					.catch((e: unknown) => toast(errorText(e), "error"))
			}
			onLater={() => {
				later.add(cwd);
				setAsking(false);
			}}
		/>
	) : null;
}

const loadGame = () => import("./knight-game.tsx");
const KnightGame = lazy(loadGame);

/**
 * A click turns the mark into a short game of chess. The board unfolds upward along the mark's centreline without
 * moving or overlapping the title. Reduced motion keeps the static mark.
 */
function HomeMark() {
	const [playing, setPlaying] = useState(false);
	const [stopping, setStopping] = useState(false);
	const [reduceMotion, setReduceMotion] = useState(() => matchMedia("(prefers-reduced-motion: reduce)").matches);
	useEffect(() => {
		const preference = matchMedia("(prefers-reduced-motion: reduce)");
		const update = () => {
			setReduceMotion(preference.matches);
			if (preference.matches) setPlaying(false);
		};
		update();
		preference.addEventListener("change", update);
		return () => preference.removeEventListener("change", update);
	}, []);
	const mark = <KnightMark size={56} className="kc-home-mark-icon block text-ink opacity-30" />;
	return (
		<button
			type="button"
			className="kc-home-mark"
			aria-label="Chess animation"
			aria-pressed={playing}
			disabled={reduceMotion}
			onPointerEnter={() => void loadGame()}
			onClick={(event) => {
				if (playing) setStopping(true);
				else if (!reduceMotion) {
					const slot = event.currentTarget;
					const area = slot.closest(".kc-home-content");
					// The board rises above the compact mark by its side less the mark's height, both from styles.css;
					// a very short viewport keeps the static mark.
					const box = slot.getBoundingClientRect();
					const overhang = parseFloat(getComputedStyle(slot).getPropertyValue("--kc-chess-board")) - box.height;
					if (area && box.top - area.getBoundingClientRect().top < overhang) return;
					setStopping(false);
					setPlaying(true);
				}
			}}
		>
			{playing ? (
				<Suspense fallback={mark}>
					<KnightGame stopping={stopping} onDone={() => setPlaying(false)} />
				</Suspense>
			) : (
				mark
			)}
		</button>
	);
}

export function Home({ cwd: requested }: { cwd?: string }) {
	const accounts = useStore((s) => s.accounts);
	const models = useStore((s) => s.models);
	const projects = useStore(selectProjects);
	const [cwd, setCwd] = useState<string | undefined>(requested ?? projects[0]?.path);
	useEffect(() => {
		if (requested) setCwd(requested);
	}, [requested]);
	useEffect(() => {
		if (!cwd && projects[0]) setCwd(projects[0].path);
	}, [cwd, projects]);
	const signedOut = accounts !== undefined && accounts.accounts.length === 0 && models.length === 0;
	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div className="kc-home-content">
				<div className="kc-home-intro">
					{signedOut ? (
						<SetupCard
							icon={<LogIn size={16} />}
							title="Sign in to a model provider to start"
							detail="Sign-ins are shared with the KnightCode terminal."
							action="Sign in"
							onAction={() => navigate({ kind: "settings", page: "models" })}
						/>
					) : null}
					{projects.length === 0 && !cwd ? (
						<SetupCard
							icon={<FolderPlus size={16} />}
							title="Add a project folder"
							detail="KnightCode works in the folder you choose."
							action="Add folder"
							onAction={() => void addProject().then((path) => path && showNew(path))}
						/>
					) : null}
					{cwd ? <TrustCard cwd={cwd} /> : null}
					<HomeMark />
					<h1 className="text-center text-xl leading-[33.6px] font-normal text-ink">
						What should we build
						{cwd ? (
							<>
								{" in "}
								<ProjectPicker
									cwd={cwd}
									onChange={setCwd}
									side="bottom"
									trigger={() => (
										<button
											type="button"
											className="inline-block max-w-full align-baseline break-words underline decoration-tertiary decoration-dotted decoration-1 underline-offset-4 hover:text-secondary"
										>
											{basename(cwd)}?
										</button>
									)}
								/>
							</>
						) : (
							"?"
						)}
					</h1>
				</div>
			</div>
			<div className="shrink-0">
				<Composer project={{ cwd, onChange: setCwd }} />
			</div>
		</div>
	);
}
