// Passkeys from the desktop (spec section 21): a spending approval or sign-in needs the user's passkey, which lives with
// the operating system. On Windows the app relays the WebAuthn request to the system (Windows Hello) and returns the
// assertion over the link. On macOS this needs Apple's associated-domains entitlement for bots.knightcode.dev, so it
// stays off until the signed build carries it; elsewhere the browser handles passkeys.

export type RelayResult =
	{ ok: true; assertion: unknown } | { ok: false; reason: "unavailable" | "cancelled" | "failed" };

export interface PasskeyRelay {
	available: boolean;
	authenticate(options: unknown): Promise<RelayResult>;
}

export function createPasskeyRelay(
	platform: NodeJS.Platform,
	deps: { authenticate(options: unknown): Promise<unknown>; macEntitlement?: boolean },
): PasskeyRelay {
	const available = platform === "win32" || (platform === "darwin" && deps.macEntitlement === true);
	return {
		available,
		async authenticate(options) {
			if (!available) return { ok: false, reason: "unavailable" };
			try {
				return { ok: true, assertion: await deps.authenticate(options) };
			} catch (error) {
				return {
					ok: false,
					reason:
						error instanceof Error && /cancel|abort|NotAllowed/i.test(`${error.name} ${error.message}`)
							? "cancelled"
							: "failed",
				};
			}
		},
	};
}
