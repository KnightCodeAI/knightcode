// Joins class names, skipping empty ones.

/** `cx("a", false, undefined, "b")` is `"a b"`. */
export function cx(...names: (string | false | null | undefined)[]): string {
	return names.filter(Boolean).join(" ");
}
