// Secret redaction (spec section 13): secrets are removed from logs, excerpts and history search. A credential a user
// once pasted into a chat must not come back through search_history or read_history, nor sit in the search index.

const PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
	/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{16,}/g,
	/\b(?:ghp|gho|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
	/\bxox[abposr]-[A-Za-z0-9-]{10,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bAIza[0-9A-Za-z_-]{35}\b/g,
	/\b(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/g,
];

/** `password: x`, `api_key=x`, `token: "x"`: the label stays, the value goes. */
const LABELLED = /\b(password|passwd|passcode|pwd|secret|token|api[_ -]?key|access[_ -]?key|client[_ -]?secret)(\s*[:=]\s*)("[^"]*"|'[^']*'|\S+)/gi;

export const REDACTED = "[redacted]";

export function redactSecrets(text: string): string {
	let out = text;
	for (const pattern of PATTERNS) out = out.replace(pattern, REDACTED);
	return out.replace(LABELLED, (_match, label: string, separator: string) => `${label}${separator}${REDACTED}`);
}
