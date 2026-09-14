export function Landing(): React.JSX.Element {
	return (
		<main className="mx-auto max-w-sm px-6 pt-[16vh] pb-16 text-center">
			<img className="mx-auto mb-7 block size-18" src="/knight.svg" alt="KnightCode" width="72" height="72" />
			<h1 className="mb-2 text-[1.75rem] leading-tight font-semibold tracking-tight">KnightCode</h1>
			<p className="text-label-2 leading-relaxed">
				Watch the sessions running on your machines, and reply to them, from any device you are signed in on.
			</p>
			<a
				className="mt-7 block w-full rounded-2xl bg-label px-5 py-3.5 text-center font-semibold text-ground transition active:scale-[0.985]"
				href="/login"
			>
				Continue with GitHub
			</a>
			<p className="mt-5 text-left text-[13px] leading-relaxed text-label-2">
				Signing in reads your GitHub username only. Sessions reach this account when you run{" "}
				<code className="rounded-md bg-raised px-1.5 py-0.5 font-mono text-[12px] whitespace-nowrap">/remote</code> in a
				terminal and approve it.
			</p>
		</main>
	);
}
