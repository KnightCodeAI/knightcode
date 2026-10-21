/**
 * `item/toolCall/requestApproval` as Codex shows a request (desktop-shell.md section 9.5), built as Codex builds its
 * approval card (measured 2026-10-18): in the composer's place, a #2d2d2d card with 25px corners and a hairline;
 * on top, 16px in, the kind of request (13px, 65%) over the question (14px medium) and its reason; then what would
 * run; then the answers, Deny (Esc) and a split Allow once (Enter) whose menu holds the longer-lived allowances and
 * a decline with instructions. The buttons are Codex's composer pills: 28px, 8px in, 13px.
 */

import { ChevronDown, FilePen, Hand, SquareTerminal } from "./icons.tsx";
import { useEffect, useRef, useState } from "react";
import { isControl, isEditable, matches, useBinding } from "../keys.ts";
import { type Approval, answerApproval } from "../store.ts";
import { Button, Kbd } from "./button.tsx";
import { Tooltip } from "./tooltip.tsx";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "./menu.tsx";

const str = (value: unknown) => (typeof value === "string" ? value : "");

export function ApprovalCard({ threadId, approval, cwd }: { threadId: string; approval: Approval; cwd: string }) {
	const { params } = approval;
	const ref = useRef<HTMLDivElement>(null);
	const [explain, setExplain] = useState(false);
	const [message, setMessage] = useState("");
	const input = ("input" in params ? params.input : {}) as Record<string, unknown>;
	const shell = params.tool === "bash" || params.tool === "powershell";
	const edit = params.tool === "edit" || params.tool === "write";
	const offered = new Set(params.decisions);
	const path = str(input.path) || str(input.file_path);

	useEffect(() => {
		// Take the focus from the composer this card hides, or from nothing; leave it in any other field.
		const active = document.activeElement;
		if (!isEditable(active) || active?.closest("[data-composer]")) ref.current?.focus();
	}, []);

	const answer = (decision: "accept" | "acceptForSession" | "acceptPrefixForSession" | "decline", text?: string) =>
		answerApproval(
			threadId,
			approval,
			decision === "decline" ? { decision, ...(text ? { message: text } : {}) } : { decision },
		);

	const kind = shell
		? { icon: <SquareTerminal size={16} />, label: "Run command" }
		: edit
			? { icon: <FilePen size={16} />, label: params.tool === "write" ? "Write file" : "Edit file" }
			: { icon: <Hand size={16} />, label: `Use ${params.tool}` };
	const question = shell
		? "Allow KnightCode to run this command?"
		: edit
			? `Allow KnightCode to ${params.tool === "write" ? "write" : "edit"} ${path.split(/[\\/]/).pop() || "this file"}?`
			: `Allow KnightCode to use ${params.tool}?`;
	// Enter and Escape answer the request wherever the focus is, as Codex binds Approve and Decline, except in a field
	// (the instructions box handles its own keys). Enter on a focused control (Deny, the chevron) is that control's.
	useBinding(
		"desktop.approval.accept",
		(event) => (isControl(event.target) ? false : answer("accept")),
		!explain && offered.has("accept"),
	);
	useBinding(
		"desktop.approval.decline",
		(event) => (isEditable(event.target) ? false : answer("decline")),
		!explain && offered.has("decline"),
	);
	const more = [
		offered.has("acceptPrefixForSession") && params.prefix ? "prefix" : undefined,
		offered.has("acceptForSession") ? "session" : undefined,
		offered.has("decline") ? "explain" : undefined,
	].filter(Boolean);

	return (
		<div
			ref={ref}
			tabIndex={-1}

			className="mx-auto w-full max-w-3xl px-4 pb-4 outline-none"
		>
			<div className="flex flex-col overflow-hidden rounded-3xl border border-line bg-panel">
				<div className="flex flex-col gap-2 px-4 pt-4 pb-3">
					<div className="flex items-center gap-2 text-sm leading-5 text-secondary">
						{kind.icon}
						{kind.label}
					</div>
					<div className="text-base leading-5 font-medium [overflow-wrap:anywhere] text-ink">{question}</div>
					{params.reason ? (
						<div className="flex gap-2 text-sm leading-5">
							<span className="shrink-0 text-tertiary">Reason</span>
							<span className="min-w-0 text-ink">{params.reason}</span>
						</div>
					) : null}
				</div>
				<div className="px-4">
					{shell ? (
						<div className="selectable rounded-lg bg-surface-secondary px-3 py-2 font-code text-code">
							<div className="whitespace-pre-wrap text-ink">{str(input.command)}</div>
							<Tooltip content={cwd} align="start">
								<div className="mt-1 w-fit text-tertiary">in {cwd.split(/[\\/]/).pop()}</div>
							</Tooltip>
						</div>
					) : edit ? (
						<Tooltip content={path} overflow>
							<div className="selectable truncate text-sm text-tertiary">{path}</div>
						</Tooltip>
					) : (
						<pre className="selectable max-h-40 overflow-auto rounded-lg bg-surface-secondary px-3 py-2 font-code text-code whitespace-pre-wrap">
							{"input" in params ? JSON.stringify(params.input, null, 2) : "(input too large to show)"}
						</pre>
					)}
				</div>
				{explain ? (
					<div className="flex items-center gap-2 px-4 pt-3 pb-4">
						<input
							autoFocus
							value={message}
							aria-label="What KnightCode should do instead"
							onChange={(e) => setMessage(e.target.value)}
							onKeyDown={(e) => {
								if (matches(e, "desktop.composer.send")) answer("decline", message);
								else if (matches(e, "desktop.picker.dismiss")) {
									e.stopPropagation();
									setExplain(false);
									ref.current?.focus();
								}
							}}
							placeholder="Tell KnightCode what to do instead"
							className="kc-input h-7 min-w-0 flex-1 rounded-full px-3"
						/>
						<Button variant="solid" pill className="px-2" onClick={() => answer("decline", message)}>
							Deny
						</Button>
					</div>
				) : (
					<div className="flex items-center justify-end gap-2 px-4 pt-3 pb-4">
						{offered.has("decline") ? (
							<Button variant="outline" pill className="gap-1.5 px-2" onClick={() => answer("decline")}>
								Deny <Kbd>Esc</Kbd>
							</Button>
						) : null}
						{offered.has("accept") ? (
							<div className="flex">
								<Button
									variant="solid"
									pill
									className={`gap-1.5 px-2 ${more.length ? "rounded-e-none" : ""}`}
									onClick={() => answer("accept")}
								>
									Allow once <Kbd>⏎</Kbd>
								</Button>
								{more.length ? (
									<Menu>
										<MenuTrigger>
											<Button
												variant="solid"
												pill
												aria-label="Approval options"
												className="rounded-s-none border-s border-inverse/15 ps-1.5 pe-2"
											>
												<ChevronDown size={14} />
											</Button>
										</MenuTrigger>
										{/* Under the button, end-aligned, as Codex's (Radix lifts it above when there's no room);
										    capped, so a long command prefix truncates rather than widening it. */}
										<MenuContent align="end" className="max-w-72">
											<MenuItem onSelect={() => answer("accept")}>Allow once</MenuItem>
											{more.includes("prefix") ? (
												<MenuItem onSelect={() => answer("acceptPrefixForSession")}>
													Allow <code className="font-code">{params.prefix}</code> in this thread
												</MenuItem>
											) : null}
											{more.includes("session") ? (
												<MenuItem onSelect={() => answer("acceptForSession")}>
													Allow {params.tool} in this thread
												</MenuItem>
											) : null}
											{more.includes("explain") ? (
												<>
													<MenuSeparator />
													<MenuItem onSelect={() => setExplain(true)}>Deny and say what to do instead…</MenuItem>
												</>
											) : null}
										</MenuContent>
									</Menu>
								) : null}
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
