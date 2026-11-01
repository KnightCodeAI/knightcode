// Spending approvals (spec section 21): a purchase is approved once, never for good, and only with the person's
// passkey. The assertion signs the approval's digest, so it confirms this exact purchase and nothing else.
import type { Approval } from "@knightcode/bots-protocol";

export type ApprovalDecision = "allow" | "always" | "deny";

/** The decisions an approval card offers, in button order. */
export function approvalDecisions(approval: Approval): ApprovalDecision[] {
	return approval.action.spend ? ["deny", "allow"] : ["deny", "always", "allow"];
}

/** Just what `confirmSpend` needs of `navigator.credentials`. */
export interface CredentialsLike {
	get(options: CredentialRequestOptions): Promise<unknown>;
}

/**
 * A passkey assertion over the approval's digest (its UTF-8 bytes are the challenge), as JSON for the API; undefined
 * when the person cancels or the device cannot do it.
 */
export async function confirmSpend(
	approval: Approval,
	credentials: CredentialsLike | undefined = globalThis.navigator?.credentials,
): Promise<unknown | undefined> {
	if (!credentials) return undefined;
	try {
		const credential = (await credentials.get({
			publicKey: {
				challenge: new TextEncoder().encode(approval.digest),
				userVerification: "required",
				timeout: 60_000,
			},
		})) as { toJSON?: () => unknown } | null;
		return credential?.toJSON?.() ?? undefined;
	} catch {
		return undefined;
	}
}
