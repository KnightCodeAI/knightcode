import { useEffect, useRef, useState } from "react";
import { fetchCsrf } from "@/lib/api";
import { cn } from "@/lib/utils";

function Mark(): React.JSX.Element {
	return <img className="mx-auto mb-7 block size-18" src="/knight.svg" alt="KnightCode" width="72" height="72" />;
}

function Code({ children }: { children: string }): React.JSX.Element {
	return <code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[0.9em] whitespace-nowrap">{children}</code>;
}

const BUTTON =
	"mt-2.5 block w-full rounded-2xl bg-label px-5 py-3.5 text-center font-semibold text-ground transition active:scale-[0.985]";

function Approved(): React.JSX.Element {
	return (
		<main className="mx-auto max-w-sm px-6 pt-[16vh] pb-16 text-center">
			<Mark />
			<h1 className="mb-2 text-[1.75rem] leading-tight font-semibold tracking-tight">Terminal approved</h1>
			<p className="text-label-2 leading-relaxed">
				You can close this tab — your terminal is signing in now, and it stays signed in until you run{" "}
				<Code>/remote logout</Code> there.
			</p>
			<a className={cn(BUTTON, "mt-7")} href="/">
				See your sessions
			</a>
		</main>
	);
}

export function Device(): React.JSX.Element {
	const params = new URLSearchParams(window.location.search);
	const [csrf, setCsrf] = useState("");
	const field = useRef<HTMLInputElement>(null);
	const invalid = params.has("invalid");
	// The form was refused because its token belonged to an earlier sign-in; this render
	// carries a fresh one, so the same code goes through on the next click.
	const stale = params.has("stale");

	// Both outcomes of the POST land back on /device as a redirect, so this one route covers
	// the form, the confirmation and the retry rather than dead-ending on plain text.
	const approved = params.has("approved");

	useEffect(() => {
		if (approved) return;
		void fetchCsrf().then(setCsrf, () => {
			// Only an unauthenticated visitor can miss the token, and the Worker has already
			// bounced those to /login; leaving it empty makes the POST fail closed.
		});
		field.current?.focus();
	}, [approved]);

	if (approved) return <Approved />;

	return (
		<main className="mx-auto max-w-sm px-6 pt-[12vh] pb-16 text-center">
			<Mark />
			<h1 className="mb-2 text-[1.75rem] leading-tight font-semibold tracking-tight">Approve this terminal</h1>
			<p className={cn("leading-relaxed", invalid || stale ? "text-danger" : "text-label-2")}>
				{invalid ? (
					"That code has expired or was already used. Check your terminal for a new one."
				) : stale ? (
					"Your sign-in changed while this page was open, so that submission was refused. The code is still good — approve it again."
				) : (
					<>
						A terminal running <strong className="font-semibold text-label">KnightCode</strong> is asking to sign in as
						you. Enter the code it is showing to approve it.
					</>
				)}
			</p>

			<form method="post" action="/device" className="mt-7 text-left">
				<input type="hidden" name="csrf" value={csrf} />
				<label className="mb-2 block text-[12px] font-medium tracking-wider text-label-2 uppercase" htmlFor="user_code">
					Code from your terminal
				</label>
				<input
					id="user_code"
					name="user_code"
					ref={field}
					// Prefilled from verification_uri_complete. Approval still needs the click.
					defaultValue={params.get("code") ?? ""}
					placeholder="XXXX-XXXX"
					autoComplete="off"
					autoCapitalize="characters"
					spellCheck={false}
					required
					className="w-full rounded-2xl border border-hairline bg-raised px-4 py-3.5 text-center font-mono text-[1.4rem] tracking-[0.18em] text-label outline-none transition focus:border-tint"
				/>
				<button type="submit" className={BUTTON}>
					Approve
				</button>
			</form>

			<p className="mt-9 border-t border-hairline pt-6 text-left text-[13px] text-label-2">An approved terminal can</p>
			<ul className="mt-3 space-y-1.5 text-left text-[14px] leading-relaxed">
				<li className="flex gap-2.5">
					<span className="text-label-2">✓</span>
					<span>
						mirror the sessions it publishes with <Code>/remote</Code>
					</span>
				</li>
				<li className="flex gap-2.5">
					<span className="text-label-2">✓</span>
					<span>deliver the replies and slash commands you send from the web</span>
				</li>
			</ul>
			<p className="mt-5 text-left text-[13px] leading-relaxed text-label-2">
				Only approve a code you started yourself, and only if it matches the one in your terminal. Codes expire ten
				minutes after <Code>/remote</Code> prints them, and each one signs in a single machine.
			</p>
		</main>
	);
}
