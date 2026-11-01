// Everything a recipe would create, each with its own checkbox, before anything is created. Things that act on their
// own (routines, apps, running setup) and other people's memory start unticked; credential-like text never comes in.
import type { Recipe } from "@knightcode/bots-protocol";
import type { ReactNode } from "react";

export interface RecipeSelection {
	instructions: boolean;
	memory: number[];
	sharedMemory: number[];
	skills: number[];
	routines: number[];
	plugins: number[];
	runSetup: boolean;
}

/** What starts ticked: instructions and skills; never memory, routines, apps or running setup. */
export function defaultSelection(recipe: Recipe): RecipeSelection {
	return {
		instructions: true,
		memory: [],
		sharedMemory: [],
		skills: recipe.skills.map((_, i) => i),
		routines: [],
		plugins: [],
		runSetup: false,
	};
}

const CREDENTIAL_PATTERNS = [
	/\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\bAIza[0-9A-Za-z_-]{30,}/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
	/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
	/\b(?:password|passwd|passcode|api[ _-]?key|secret|token|pin)\b\s*(?:is|[:=])\s*\S+/gi,
];

/** `text` with anything that looks like a credential replaced, and how many were removed. */
export function redactCredentials(text: string): { text: string; removed: number } {
	let removed = 0;
	let out = text;
	for (const pattern of CREDENTIAL_PATTERNS)
		out = out.replace(pattern, () => {
			removed++;
			return "[removed]";
		});
	return { text: out, removed };
}

/** `value` with credential-like text removed from every string in it, however deep. */
function redactDeep<T>(value: T): T {
	if (typeof value === "string") return redactCredentials(value).text as T;
	if (Array.isArray(value)) return value.map(redactDeep) as T;
	if (value && typeof value === "object")
		return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, redactDeep(inner)])) as T;
	return value;
}

/**
 * The recipe as it will be sent: credential-like text removed from every field (names included), unticked
 * instructions dropped, and memory reduced to the entries chosen. Memory keeps its positions, so the chosen indexes
 * still point at the right entries, but an entry that was not chosen, or that holds a credential, goes out empty.
 */
export function cleanRecipe(recipe: Recipe, selection: RecipeSelection): Recipe {
	const chosen = new Set([...selection.memory, ...selection.sharedMemory]);
	const clean = redactDeep(recipe);
	return {
		...clean,
		profile: { ...clean.profile, description: selection.instructions ? clean.profile.description : "" },
		memory: recipe.memory.map((entry, i) =>
			chosen.has(i) && !memoryBlocked(entry.content) ? { ...entry, content: entry.content } : { ...entry, content: "" },
		),
	};
}

/** Memory entries holding a credential cannot be ticked at all. */
export const memoryBlocked = (content: string) => redactCredentials(content).removed > 0;

export interface RecipePreviewProps {
	recipe: Recipe;
	selection: RecipeSelection;
	onChange: (selection: RecipeSelection) => void;
	/** The answer came from the user's own agent through the copy prompt, so memory may go to shared memory. */
	own: boolean;
}

/** The checklist. */
export function RecipePreview({ recipe, selection, onChange, own }: RecipePreviewProps) {
	const toggle = (key: "memory" | "sharedMemory" | "skills" | "routines" | "plugins", index: number, on: boolean) =>
		onChange({ ...selection, [key]: on ? [...selection[key], index] : selection[key].filter((i) => i !== index) });
	const instructions = redactCredentials(recipe.profile.description);
	return (
		<div className="kb-recipe">
			{!own && (
				<p className="kb-recipe__warning">
					This recipe was written outside KnightCode. Read its instructions and skills before you create the bot: they
					will guide what it does.
				</p>
			)}
			<Group title="Instructions">
				<Item
					label="Instructions"
					checked={selection.instructions}
					onChange={(on) => onChange({ ...selection, instructions: on })}
					detail={instructions.text || "None"}
					note={instructions.removed ? `${instructions.removed} credential-like value removed` : undefined}
				/>
			</Group>
			{recipe.memory.length > 0 && (
				<Group
					title="Memory"
					hint={own ? "Goes to this bot's notes, or to every bot's shared memory." : "Goes to this bot's notes only."}
				>
					{recipe.memory.map((item, i) => {
						const blocked = memoryBlocked(item.content);
						return (
							<Item
								key={i}
								label={redactCredentials(item.content).text}
								checked={selection.memory.includes(i)}
								disabled={blocked}
								note={blocked ? "Looks like a credential, so it is not imported" : undefined}
								onChange={(on) => toggle("memory", i, on)}
								extra={
									own &&
									!blocked && (
										<label className="kb-recipe__share">
											<input
												type="checkbox"
												checked={selection.sharedMemory.includes(i)}
												onChange={(event) => toggle("sharedMemory", i, event.target.checked)}
											/>
											Share with all my bots
										</label>
									)
								}
							/>
						);
					})}
				</Group>
			)}
			{recipe.skills.length > 0 && (
				<Group title="Skills" hint="Added to your skills.">
					{recipe.skills.map((skill, i) => (
						<Item
							key={skill.name}
							label={`${skill.name}: ${skill.description}`}
							checked={selection.skills.includes(i)}
							onChange={(on) => toggle("skills", i, on)}
							detail={redactCredentials(skill.content).text}
						/>
					))}
				</Group>
			)}
			{recipe.routines.length > 0 && (
				<Group title="Routines" hint="Arrive paused, with no trigger until you add one.">
					{recipe.routines.map((routine, i) => (
						<Item
							key={routine.slug}
							label={`${routine.name}: ${routine.description}`}
							checked={selection.routines.includes(i)}
							onChange={(on) => toggle("routines", i, on)}
							detail={redactCredentials(routine.content).text}
						/>
					))}
				</Group>
			)}
			{recipe.plugins.length > 0 && (
				<Group title="Apps to connect" hint="Listed for you to connect; nothing connects by itself.">
					{recipe.plugins.map((plugin, i) => (
						<Item
							key={`${plugin.pluginId}-${i}`}
							label={plugin.name}
							checked={selection.plugins.includes(i)}
							onChange={(on) => toggle("plugins", i, on)}
						/>
					))}
				</Group>
			)}
			{recipe.gettingStarted && (
				<Group title="Setup" hint="A Run setup button is added to the bot either way.">
					<Item
						label={`Run setup now ("${recipe.gettingStarted.skill}")`}
						checked={selection.runSetup}
						onChange={(on) => onChange({ ...selection, runSetup: on })}
					/>
				</Group>
			)}
		</div>
	);
}

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
	return (
		<section className="kb-recipe__group">
			<h3 className="kb-recipe__title">{title}</h3>
			{hint && <p className="kb-recipe__hint">{hint}</p>}
			<div className="kb-recipe__items">{children}</div>
		</section>
	);
}

function Item(props: {
	label: string;
	checked: boolean;
	onChange: (on: boolean) => void;
	disabled?: boolean;
	detail?: string;
	note?: string;
	extra?: ReactNode;
}) {
	return (
		<div className="kb-recipe__item">
			<label className="kb-recipe__check">
				<input
					type="checkbox"
					checked={props.checked}
					disabled={props.disabled}
					onChange={(event) => props.onChange(event.target.checked)}
				/>
				<span>{props.label}</span>
			</label>
			{props.note && <p className="kb-recipe__note">{props.note}</p>}
			{props.detail && <pre className="kb-recipe__text">{props.detail}</pre>}
			{props.extra}
		</div>
	);
}
