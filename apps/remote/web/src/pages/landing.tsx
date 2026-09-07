import "../styles/auth.css";

export function Landing(): React.JSX.Element {
	return (
		<main className="auth">
			<div className="marks">
				<img className="mark mark-knight" src="/knight.svg" alt="KnightCode" width="72" height="72" />
			</div>
			<h1>KnightCode remote</h1>
			<p className="lede">
				Watch the sessions running on your machines, and reply to them, from any device you are signed in on.
			</p>
			<a className="button" href="/login">
				Continue with GitHub
			</a>
			<p className="note">
				Signing in reads your GitHub username only. Sessions reach this account when you run <code>/remote</code> in a
				terminal and approve it.
			</p>
		</main>
	);
}
