import type { KnightCodeHint } from '../knightCodeHints.js'

// The plugins subsystem (marketplace, installed-plugin manager, plugin policy)
// is out of scope. Shell tools scan command output for <knightcode-code-hint /> tags
// and route them here; until plugins land this records nothing. The tag is still
// stripped from model-facing output before this call, so behavior is
// correct — only the recommendation dialog is deferred.

export function maybeRecordPluginHint(_hint: KnightCodeHint): void {}
