// The tools behind a reply, shown only when the bot's "Show tools used" setting is on.
import { ChevronRight, Wrench } from "lucide-react";
import { useState } from "react";

/** A collapsed "Used N tools" line that lists them when opened. */
export function ToolActivity({ tools }: { tools: string[] }) {
	const [open, setOpen] = useState(false);
	if (tools.length === 0) return null;
	return (
		<div className="kb-tools">
			<button type="button" className="kb-tools__toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
				<Wrench size={12} />
				Used {tools.length} {tools.length === 1 ? "tool" : "tools"}
				<ChevronRight size={12} className="kb-tools__chevron" />
			</button>
			{open && (
				<ul className="kb-tools__list">
					{tools.map((tool, i) => (
						<li key={`${tool}-${i}`}>{tool}</li>
					))}
				</ul>
			)}
		</div>
	);
}
