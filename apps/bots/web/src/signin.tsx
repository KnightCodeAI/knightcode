// Signing in to the web app (spec section 4): GitHub, Google or a one-time email code, and choosing the handle a new
// account's bots' addresses use. Passkeys sign in from the same screen once one is added in Settings.
import { type ApiClient, ApiError } from "@knightcode/bots-protocol";
import { Button, Input } from "@knightcode/bots-ui";
import { type FormEvent, useState } from "react";
import "./signin.css";

const next = () => new URLSearchParams(location.search).get("next") ?? (location.pathname === "/signin" ? "/" : location.pathname + location.search);

const ERRORS: Record<string, string> = {
	state: "That sign-in expired. Try again.",
	denied: "Sign-in was cancelled.",
	profile: "We could not read your profile. Try again.",
};

export function SignIn() {
	const [email, setEmail] = useState("");
	const [code, setCode] = useState("");
	const [sent, setSent] = useState(false);
	const [error, setError] = useState(() => ERRORS[new URLSearchParams(location.search).get("error") ?? ""] ?? "");
	const post = (path: string, body: unknown) =>
		fetch(path, { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
	const sendCode = async (event: FormEvent) => {
		event.preventDefault();
		const response = await post("/auth/email", { email });
		if (response.ok) setSent(true);
		else setError(response.status === 429 ? "Too many codes; wait a little." : "We could not send a code to that address.");
	};
	const verify = async (event: FormEvent) => {
		event.preventDefault();
		const response = await post("/auth/email/verify", { email, code, next: next() });
		if (!response.ok) return setError("That code is not right, or it expired.");
		const body = (await response.json().catch(() => ({}))) as { next?: string };
		location.assign(body.next ?? next());
	};
	const oauth = (provider: "github" | "google") => location.assign(`/auth/${provider}?next=${encodeURIComponent(next())}`);
	return (
		<main className="kb-signin">
			<div className="kb-signin__card">
				<h1 className="kb-signin__title">Sign in to KnightCode Bots</h1>
				{error && (
					<p className="kb-signin__error" role="alert">
						{error}
					</p>
				)}
				<Button variant="primary" onClick={() => oauth("github")}>
					Continue with GitHub
				</Button>
				<Button onClick={() => oauth("google")}>Continue with Google</Button>
				<div className="kb-signin__or">or</div>
				{sent ? (
					<form className="kb-signin__form" onSubmit={verify}>
						<label htmlFor="kb-signin-code">The code we sent to {email}</label>
						<Input id="kb-signin-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => setCode(event.target.value)} />
						<Button type="submit">Sign in</Button>
					</form>
				) : (
					<form className="kb-signin__form" onSubmit={sendCode}>
						<label htmlFor="kb-signin-email">Email</label>
						<Input id="kb-signin-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} />
						<Button type="submit">Email me a code</Button>
					</form>
				)}
			</div>
		</main>
	);
}

const HANDLE_RESULTS: Record<string, string> = {
	taken: "That handle is taken.",
	invalid: "Use 3 to 20 lowercase letters, digits and hyphens.",
	reserved: "That handle is reserved.",
};

export function ChooseHandle({ api, suggestion }: { api: ApiClient; suggestion: string }) {
	const [handle, setHandle] = useState(suggestion);
	const [error, setError] = useState("");
	const submit = async (event: FormEvent) => {
		event.preventDefault();
		try {
			const { result } = await api.claimHandle({ handle });
			if (result === "ok") return location.assign(next() === "/handle" ? "/" : next());
			setError(HANDLE_RESULTS[result] ?? "That handle cannot be used.");
		} catch (failure) {
			setError(failure instanceof ApiError ? failure.message : "Something went wrong.");
		}
	};
	return (
		<main className="kb-signin">
			<form className="kb-signin__card" onSubmit={submit}>
				<h1 className="kb-signin__title">Choose your handle</h1>
				<p className="kb-signin__hint">It is part of every bot's email address, such as scout.{handle || "you"}@bots.knightcode.dev.</p>
				<label htmlFor="kb-handle">Handle</label>
				<Input id="kb-handle" value={handle} onChange={(event) => setHandle(event.target.value.toLowerCase())} />
				{error && (
					<p className="kb-signin__error" role="alert">
						{error}
					</p>
				)}
				<Button variant="primary" type="submit">
					Continue
				</Button>
			</form>
		</main>
	);
}

/** A handle suggested from the account's name: lowercase letters, digits and hyphens, 3 to 20 characters. */
export function suggestHandle(name: string): string {
	const base = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 20);
	return base.length >= 3 ? base : "";
}
