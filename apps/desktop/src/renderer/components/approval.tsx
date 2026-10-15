/**
 * `item/toolCall/requestApproval` as Codex shows a request (desktop-shell.md section 9.5): a card in the
 * composer's place with the request, its reason, Deny (Esc) and a split Allow once (Enter) whose menu holds
 * the longer-lived allowances and a decline with instructions.
 */

import { ChevronDown, FilePen, Hand, SquareTerminal } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { matches } from "../keys.ts";
import { type Approval, answerApproval } from "../store.ts";
import { MenuItem, Popover } from "./popover.tsx";

const str = (value: unknown) => (typeof value === "string" ? value : "");

function Kbd({ children }: { children: ReactNode }) {
	return <kbd className="rounded-[5px] bg-current/10 px-1 font-ui text-[11px] leading-4">{children}</kbd>;
}

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
		// Take focus unless the user is typing somewhere.
		if (!["TEXTAREA", "INPUT"].includes(document.activeElement?.tagName ?? "")) ref.current?.focus();
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
	const more = [
		offered.has("acceptPrefixForSession") && params.prefix ? "prefix" : undefined,
		offered.has("acceptForSession") ? "session" : undefined,
		offered.has("decline") ? "explain" : undefined,
	].filter(Boolean);

	return (
		<div
			ref={ref}
			tabIndex={-1}
			onKeyDown={(event) => {
				if (explain || event.target !== ref.current) return;
				if (matches(event, "desktop.approval.accept") && offered.has("accept")) {
					event.preventDefault();
					answer("accept");
				} else if (matches(event, "desktop.approval.decline") && offered.has("decline")) {
					event.preventDefault();
					answer("decline");
				}
			}}
			className="mx-auto w-full max-w-3xl px-4 pb-4 outline-none"
		>
			<div className="rounded-[25px] border border-hairline bg-panel px-[18px] py-3.5">
				<div className="flex items-center gap-2 text-[13px] text-head">
					{kind.icon}
					{kind.label}
				</div>
				<div className="mt-2.5 text-[14px] leading-5 font-medium text-ink">{question}</div>
				{shell ? (
					<div className="selectable mt-2 rounded-xl bg-shell px-3 py-2 font-code text-[length:var(--kc-size-code)]">
						<div className="whitespace-pre-wrap text-ink">{str(input.command)}</div>
						<div className="mt-1 text-desc" title={cwd}>
							in {cwd.split(/[\\/]/).pop()}
						</div>
					</div>
				) : edit ? (
					<div className="selectable mt-1 truncate text-[13px] text-desc" title={path}>
						{path}
					</div>
				) : (
					<pre className="selectable mt-2 max-h-40 overflow-auto rounded-xl bg-shell px-3 py-2 font-code text-[length:var(--kc-size-code)] whitespace-pre-wrap">
						{"input" in params ? JSON.stringify(params.input, null, 2) : "(input too large to show)"}
					</pre>
				)}
				{params.reason ? <div className="mt-1.5 text-[13px] leading-[19.5px] text-desc">{params.reason}</div> : null}
				{explain ? (
					<div className="mt-3 flex items-center gap-2">
						<input
							autoFocus
							value={message}
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
							className="h-8 min-w-0 flex-1 rounded-full border border-hairline bg-shell px-3 text-[13px] outline-none placeholder:text-desc focus:border-accent focus-visible:outline-none"
						/>
						<button
							type="button"
							onClick={() => answer("decline", message)}
							className="h-7 rounded-full bg-ink px-3 text-[13px] text-surface hover:opacity-90"
						>
							Deny
						</button>
					</div>
				) : (
					<div className="mt-3 flex items-center justify-end gap-2">
						{offered.has("decline") ? (
							<button
								type="button"
								onClick={() => answer("decline")}
								className="flex h-7 items-center gap-1.5 rounded-full border border-hairline pr-1.5 pl-2.5 text-[13px] text-ink hover:bg-row"
							>
								Deny <Kbd>Esc</Kbd>
							</button>
						) : null}
						{offered.has("accept") ? (
							<div className="flex">
								<button
									type="button"
									onClick={() => answer("accept")}
									className={`flex h-7 items-center gap-1.5 bg-ink pr-1.5 pl-2.5 text-[13px] text-surface hover:opacity-90 ${more.length ? "rounded-l-full" : "rounded-full"}`}
								>
									Allow once <Kbd>⏎</Kbd>
								</button>
								{more.length ? (
									<Popover
										align="right"
										trigger={() => (
											<button
												type="button"
												aria-label="Approval options"
												className="flex h-7 items-center rounded-r-full border-l border-surface/20 bg-ink pr-2 pl-1.5 text-surface hover:opacity-90"
											>
												<ChevronDown size={14} />
											</button>
										)}
									>
										{(close) => (
											<div className="w-72">
												<MenuItem
													onClick={() => {
														close();
														answer("accept");
													}}
												>
													Allow once
												</MenuItem>
												{more.includes("prefix") ? (
													<MenuItem
														onClick={() => {
															close();
															answer("acceptPrefixForSession");
														}}
													>
														Allow <code className="font-code">{params.prefix}</code> in this thread
													</MenuItem>
												) : null}
												{more.includes("session") ? (
													<MenuItem
														onClick={() => {
															close();
															answer("acceptForSession");
														}}
													>
														Allow {params.tool} in this thread
													</MenuItem>
												) : null}
												{more.includes("explain") ? (
													<MenuItem
														onClick={() => {
															close();
															setExplain(true);
														}}
													>
														Deny and say what to do instead…
													</MenuItem>
												) : null}
											</div>
										)}
									</Popover>
								) : null}
							</div>
						) : null}
					</div>
				)}
			</div>
		</div>
	);
}
