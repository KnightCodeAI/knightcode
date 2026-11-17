/** Shared patch engine and theme/highlighter services; the transcript owns its surrounding card. */
import { isHighlighterLoaded, type FileDiffOptions } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import { useEffect, useMemo, useState } from "react";
import diffOverrides from "../diff-overrides.css?raw";
import { highlighterReady } from "../components/changes.tsx";
import { selectPreferences, useStore } from "../store.ts";
export function ToolPatch({ patch }: { patch: string }) {
	const [ready, setReady] = useState(isHighlighterLoaded);
	useEffect(() => {
		if (!ready) void highlighterReady.then(() => setReady(true));
	}, [ready]);
	const themeType = useStore((s) => s.resolvedTheme);
	const indicators = useStore((s) => selectPreferences(s).diffMarkers) === "plusMinus" ? "classic" : "bars";
	const options = useMemo<FileDiffOptions<undefined, undefined>>(
		() => ({
			theme: { dark: "pierre-dark", light: "pierre-light" },
			themeType,
			diffStyle: "unified",
			diffIndicators: indicators,
			overflow: "scroll",
			hunkSeparators: "line-info",
			lineDiffType: "word-alt",
			disableFileHeader: true,
			unsafeCSS: diffOverrides,
		}),
		[themeType, indicators],
	);
	return ready ? <PatchDiff patch={patch} disableWorkerPool options={options} /> : null;
}
