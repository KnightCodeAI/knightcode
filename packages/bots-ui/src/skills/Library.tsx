// The skills library: Your skills (written by the user or saved by bots), From apps (added with connectors) and
// Browse (from the catalogs). New skill writes one by hand; From GitHub previews a repository's skills and adds them.
import type { Skill } from "@knightcode/bots-protocol";
import { ArrowUpRight, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { BrowserDialog, Chips, Row, SearchRow, Section } from "../connectors/Catalog.tsx";
import { useResource, useStore } from "../state/store.ts";
import { FromGitHub } from "./FromGitHub.tsx";
import { SkillEditor } from "./SkillEditor.tsx";

type Filter = "all" | "yours" | "apps" | "browse";

const GROUPS: { id: Exclude<Filter, "all">; title: string; matches: (skill: Skill) => boolean }[] = [
	{ id: "yours", title: "Your skills", matches: (s) => s.scope === "user" || s.scope === "bot" },
	{ id: "apps", title: "From apps", matches: (s) => s.scope === "app" },
	{ id: "browse", title: "Browse", matches: (s) => s.scope === "catalog" },
];

/** The Skills dialog. */
export function SkillsLibrary({ onClose }: { onClose: () => void }) {
	const store = useStore();
	const { data } = useResource("skills:all", (api) => api.listSkills({}));
	const [query, setQuery] = useState("");
	const [filter, setFilter] = useState<Filter>("all");
	const [editing, setEditing] = useState<Skill | "new">();
	const [github, setGithub] = useState(false);
	const needle = query.trim().toLowerCase();
	const skills = (data?.skills ?? []).filter(
		(s) => !needle || `${s.name} ${s.description}`.toLowerCase().includes(needle),
	);
	const refresh = () => store.reload("skills:all");
	return (
		<BrowserDialog
			title="Skills"
			onClose={onClose}
			side={
				<button type="button" className="kb-browser__connected" onClick={() => setEditing("new")}>
					<Plus size={14} /> New skill
				</button>
			}
		>
			<SearchRow
				label="Search skills"
				placeholder="Search skills"
				value={query}
				onChange={setQuery}
				side={
					<button type="button" className="kb-browser__side" onClick={() => setGithub(true)}>
						From GitHub
						<ArrowUpRight size={16} className="kb-browser__side-arrow" />
					</button>
				}
			/>
			<Chips
				label="Skill groups"
				value={filter}
				onChange={(next) => setFilter(next as Filter)}
				items={[{ value: "all", label: "All" }, ...GROUPS.map((g) => ({ value: g.id, label: g.title }))]}
			/>
			<div className="kb-browser__scroll">
				{GROUPS.filter((g) => filter === "all" || filter === g.id).map((group) => (
					<Section key={group.id} title={group.title} empty={filter === group.id ? "Nothing here yet." : undefined}>
						{skills.filter(group.matches).map((skill) => (
							<Row
								key={skill.id}
								icon={
									<span className="kb-app-tile kb-app-tile--skill" data-app-icon="" aria-hidden>
										<Sparkles size={18} strokeWidth={1.75} />
									</span>
								}
								title={skill.name}
								detail={skill.description}
								onOpen={() => setEditing(skill)}
								action={
									group.id === "browse" ? (
										<button
											type="button"
											className="kb-pill"
											aria-label={`Add ${skill.name}`}
											onClick={() =>
												void store.api
													.createSkill({ name: skill.name, description: skill.description, content: skill.content })
													.then(refresh)
											}
										>
											Add
										</button>
									) : (
										<button
											type="button"
											className="kb-pill"
											aria-label={`Edit ${skill.name}`}
											onClick={() => setEditing(skill)}
										>
											Edit
										</button>
									)
								}
							/>
						))}
					</Section>
				))}
			</div>
			{editing && (
				<SkillEditor
					skill={editing === "new" ? undefined : editing}
					onClose={() => setEditing(undefined)}
					onSaved={refresh}
				/>
			)}
			{github && <FromGitHub onClose={() => setGithub(false)} onAdded={refresh} />}
		</BrowserDialog>
	);
}
