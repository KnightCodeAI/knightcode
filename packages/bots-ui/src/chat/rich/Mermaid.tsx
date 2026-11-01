// A Mermaid diagram from a ```mermaid block. Mermaid runs in strict mode: labels are escaped and click handlers are
// off, so a reply cannot run code through a diagram. While it renders, the source shows as code.
import mermaid from "mermaid";
import { useEffect, useId, useState } from "react";
import { currentTheme } from "../../theme.ts";

let configured: "dark" | "light" | undefined;

function configure(): void {
	const theme = currentTheme();
	if (configured === theme) return;
	mermaid.initialize({
		startOnLoad: false,
		securityLevel: "strict",
		theme: theme === "dark" ? "dark" : "neutral",
		fontFamily: "inherit",
	});
	configured = theme;
}

/** Renders the diagram, or the source with the error when it does not parse. */
export function Mermaid({ source }: { source: string }) {
	const id = `kb-mermaid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
	const [svg, setSvg] = useState<string>();
	const [error, setError] = useState<string>();
	useEffect(() => {
		let live = true;
		configure();
		mermaid.render(id, source).then(
			(result) => {
				if (!live) return;
				// A source that failed while it streamed in and now parses draws normally.
				setError(undefined);
				setSvg(result.svg);
			},
			(cause: unknown) => live && setError(cause instanceof Error ? cause.message : "This diagram could not be drawn."),
		);
		return () => {
			live = false;
		};
	}, [id, source]);
	if (error)
		return (
			<figure className="kb-diagram kb-diagram--error">
				<pre>
					<code>{source}</code>
				</pre>
				<figcaption>{error}</figcaption>
			</figure>
		);
	if (!svg)
		return (
			<pre>
				<code>{source}</code>
			</pre>
		);
	// The SVG comes from Mermaid's strict renderer, which sanitizes every label.
	return <figure className="kb-diagram" role="img" aria-label="Diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}
