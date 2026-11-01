// Signing out of the web app: the server ends the session (and its live connections), then the app leaves for the
// home page, which offers sign-in. The desktop app owns its session and signs out itself.

export async function signOut(): Promise<void> {
	await fetch("/auth/sign-out", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
	location.assign("/");
}
