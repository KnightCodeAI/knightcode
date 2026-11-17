/** Stable built-in IDs and the host-supported replacement surface vocabulary. */
export const STRUCTURAL_BUILTINS = {
	feedback: "builtin.feedback/toasts",
	layout: "builtin.layout/default",
	navigation: "builtin.navigation/default",
	threadList: "builtin.thread-list/default",
	home: "builtin.home/default",
	titleBar: "builtin.title-bar/default",
	composer: "builtin.composer/default",
	threadHeader: "builtin.thread-header/default",
	requests: "builtin.requests/default",
} as const;
export type ProviderSurface = keyof typeof STRUCTURAL_BUILTINS;
