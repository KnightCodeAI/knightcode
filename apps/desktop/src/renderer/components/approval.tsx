/** `item/toolCall/requestApproval` as a card above the composer (desktop-shell.md section 9.5). */

import { ShieldQuestion } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { matches } from "../keys.ts";
import { type Approval, answerApproval } from "../store.ts";

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

	useEffect(() => {
		// Take focus unless the user is typing in the composer.
		if (document.activeElement?.tagName !== "TEXTAREA") ref.current?.focus();
	}, []);

	const answer = (decision: "accept" | "acceptForSession" | "acceptPrefixForSession" | "decline", text?: string) =>
		answerApproval(
			threadId,
			approval,
			decision === "decline" ? { decision, ...(text ? { message: text } : {}) } : { decision },
		);

	return (
		<div
			ref={ref}
			tabIndex={-1}
			onKeyDown={(event) => {
				if (explain) return;
				if (matches(event, "desktop.approval.accept") && offered.has("accept")) {
					event.preventDefault();
					answer("accept");
				} else if (matches(event, "desktop.approval.decline") && offered.has("decline")) {
					event.preventDefault();
					answer("decline");
				}
			}}
			className="mx-auto mb-3 w-full max-w-3xl rounded-xl border border-warning/40 bg-elevated p-4 shadow-lg outline-none focus:border-warning"
		>
			<div className="mb-2 flex items-center gap-2 font-medium">
				<ShieldQuestion size={16} className="text-warning" />
				{shell
					? "Run this command?"
					: edit
						? `${params.tool === "write" ? "Write" : "Edit"} this file?`
						: `Allow ${params.tool}?`}
			</div>
			{shell ? (
				<div className="selectable mb-3 rounded-md bg-shell px-3 py-2 font-code text-[length:var(--kc-size-code)]">
					<div className="whitespace-pre-wrap text-ink">$ {str(input.command)}</div>
					<div className="mt-1 text-faint">in {cwd}</div>
				</div>
			) : edit ? (
				<div className="selectable mb-3 rounded-md bg-shell px-3 py-2 font-code text-[length:var(--kc-size-code)]">
					{str(input.path)}
				</div>
			) : (
				<pre className="selectable mb-3 max-h-48 overflow-auto rounded-md bg-shell px-3 py-2 font-code text-[length:var(--kc-size-code)] whitespace-pre-wrap">
					{"input" in params ? JSON.stringify(params.input, null, 2) : "(input too large to show)"}
				</pre>
			)}
			{params.reason ? <div className="mb-3 text-muted">Reason: {params.reason}</div> : null}
			{explain ? (
				<div className="flex gap-2">
					<input
						autoFocus
						value={message}
						onChange={(e) => setMessage(e.target.value)}
						onKeyDown={(e) => {
							if (matches(e, "desktop.composer.send")) answer("decline", message);
						}}
						placeholder="Tell KnightCode what to do instead"
						className="flex-1 rounded-md border border-line bg-shell px-3 py-1.5 outline-none focus:border-accent"
					/>
					<button
						type="button"
						onClick={() => answer("decline", message)}
						className="rounded-md bg-danger px-3 py-1.5 font-medium text-on-accent"
					>
						Deny
					</button>
				</div>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					{offered.has("accept") ? (
						<button
							type="button"
							onClick={() => answer("accept")}
							className="rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
						>
							Allow once
						</button>
					) : null}
					{offered.has("acceptPrefixForSession") && params.prefix ? (
						<button
							type="button"
							onClick={() => answer("acceptPrefixForSession")}
							className="rounded-md border border-line-strong px-3 py-1.5 hover:bg-hover"
						>
							Allow <code className="font-code">{params.prefix}</code> for this thread
						</button>
					) : null}
					{offered.has("acceptForSession") ? (
						<button
							type="button"
							onClick={() => answer("acceptForSession")}
							className="rounded-md border border-line-strong px-3 py-1.5 hover:bg-hover"
						>
							Allow {params.tool} for this thread
						</button>
					) : null}
					{offered.has("decline") ? (
						<>
							<button
								type="button"
								onClick={() => answer("decline")}
								className="rounded-md px-3 py-1.5 text-danger hover:bg-hover"
							>
								Deny
							</button>
							<button
								type="button"
								onClick={() => setExplain(true)}
								className="rounded-md px-2 py-1.5 text-muted hover:bg-hover"
							>
								Deny and explain…
							</button>
						</>
					) : null}
				</div>
			)}
		</div>
	);
}
