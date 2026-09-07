import { useEffect, useRef, useState } from "react";
import { fetchCsrf } from "../lib/api.ts";
import "../styles/auth.css";

function Mark(): React.JSX.Element {
	return (
		<div className="marks">
			<img className="mark mark-knight" src="/knight.svg" alt="KnightCode" width="72" height="72" />
		</div>
	);
}

function Approved(): React.JSX.Element {
	return (
		<main className="auth">
			<Mark />
			<h1>Terminal approved</h1>
			<p className="lede">
				You can close this tab — your terminal is signing in now, and it stays signed in until you run{" "}
				<code>/remote logout</code> there.
			</p>
			<a className="button" href="/">
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
		<main className="auth">
			<Mark />
			<h1>Approve this terminal</h1>
			<p className={invalid || stale ? "lede error" : "lede"}>
				{invalid ? (
					"That code has expired or was already used. Check your terminal for a new one."
				) : stale ? (
					"Your sign-in changed while this page was open, so that submission was refused. The code is still good — approve it again."
				) : (
					<>
						A terminal running <strong>KnightCode</strong> is asking to sign in as you. Enter the code it is showing to
						approve it.
					</>
				)}
			</p>

			<form method="post" action="/device">
				<input type="hidden" name="csrf" value={csrf} />
				<label className="field-label" htmlFor="user_code">
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
				/>
				<button type="submit">Approve</button>
			</form>

			<p className="scopes-title">An approved terminal can</p>
			<ul className="scopes">
				<li>
					mirror the sessions it publishes with <code>/remote</code>
				</li>
				<li>deliver the replies you send from the web</li>
			</ul>
			<p className="note">
				Only approve a code you started yourself, and only if it matches the one in your terminal. Codes expire ten
				minutes after <code>/remote</code> prints them, and each one signs in a single machine.
			</p>
		</main>
	);
}
