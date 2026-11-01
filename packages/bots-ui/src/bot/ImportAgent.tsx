// Import an agent from another app: copy a prompt to the old assistant, paste its answer (or pick the file it made),
// review every item, then create. Only pasted or picked text is read; nothing is fetched from anywhere.
import { parseRecipe, type Recipe } from "@knightcode/bots-protocol";
import { Check, Copy, FileUp } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Button } from "../primitives/Button.tsx";
import { Textarea } from "../primitives/Input.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { navigate } from "../shell/routes.ts";
import { BOTS, useStore } from "../state/store.ts";
import { describeError } from "./CreateBot.tsx";
import { cleanRecipe, defaultSelection, RecipePreview, type RecipeSelection } from "./RecipePreview.tsx";

/** The prompt the user sends to the assistant they are leaving. It asks for exactly the recipe format. */
export const COPY_PROMPT = `I'm moving you to KnightCode Bots. Write yourself out as one JSON block in exactly this shape, and nothing else:

{
  "profile": { "name": "your name", "description": "your full instructions, word for word" },
  "memory": [{ "kind": "profile", "content": "one thing you remember about me" }],
  "skills": [{ "name": "short-name", "description": "when to use it", "content": "the full steps" }],
  "routines": [{ "name": "name", "slug": "name", "description": "when it runs (its trigger, in words)", "content": "the full prompt it runs" }],
  "plugins": [{ "name": "app name", "pluginId": "app id" }],
  "gettingStarted": { "skill": "the name of a skill above to run first, if any" }
}

Include every routine, skill and connected app you have, and everything you remember about me, one fact per memory entry. Leave out passwords, keys, tokens and anything else secret. Leave out "gettingStarted" if there is no setup skill.`;

/** The first JSON object in `text`, unwrapping a fenced code block if the answer came in one. */
export function extractJson(text: string): string {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	return (fenced ? fenced[1]! : text).trim();
}

/** The import view of the create dialog; it brings its own footer. */
export function ImportAgent({ tabs, onCancel }: { tabs: ReactNode; onCancel: () => void }) {
	const store = useStore();
	const toast = useToast();
	const [text, setText] = useState("");
	const [recipe, setRecipe] = useState<Recipe>();
	const [selection, setSelection] = useState<RecipeSelection>();
	const [problem, setProblem] = useState<string>();
	const [own, setOwn] = useState(false);
	const [copied, setCopied] = useState(false);
	const [busy, setBusy] = useState(false);
	const file = useRef<HTMLInputElement>(null);

	const read = (value: string) => {
		setText(value);
		if (!value.trim()) {
			setRecipe(undefined);
			setProblem(undefined);
			return;
		}
		try {
			const parsed = parseRecipe(extractJson(value));
			setRecipe(parsed);
			setSelection(defaultSelection(parsed));
			setProblem(undefined);
		} catch (cause) {
			setRecipe(undefined);
			setProblem(cause instanceof Error ? cause.message : "This is not a recipe.");
		}
	};
	const copy = async () => {
		await navigator.clipboard?.writeText(COPY_PROMPT).catch(() => undefined);
		setOwn(true);
		setCopied(true);
		setTimeout(() => setCopied(false), 1500);
	};
	const create = async () => {
		if (!recipe || !selection) return;
		setBusy(true);
		try {
			const { bot, unmatchedPlugins } = await store.api.importRecipe({
				recipe: cleanRecipe(recipe, selection),
				origin: own ? "self" : "other",
				memory: selection.memory,
				sharedMemory: own ? selection.sharedMemory : [],
				skills: selection.skills,
				routines: selection.routines,
				plugins: selection.plugins,
				runSetup: selection.runSetup,
			});
			store.reload(BOTS);
			if (unmatchedPlugins.length) toast({ text: `Not in the catalog yet: ${unmatchedPlugins.join(", ")}` });
			navigate({ name: "bot", botId: bot.id, pane: "details" });
		} catch (cause) {
			setProblem(describeError(cause));
		} finally {
			setBusy(false);
		}
	};

	return (
		<>
			<div className="kb-dialog__body kb-create__body kb-import">
				<p className="kb-import__intro">
					Send this prompt to the assistant or bot you are leaving, then paste its answer here.
				</p>
				<div className="kb-import__actions">
					<Button variant="secondary" size="sm" onClick={() => void copy()}>
						{copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy prompt"}
					</Button>
					<Button variant="secondary" size="sm" onClick={() => file.current?.click()}>
						<FileUp size={14} /> Choose a file
					</Button>
					<input
						ref={file}
						type="file"
						accept=".json,application/json"
						hidden
						onChange={async (event) => {
							const picked = event.target.files?.[0];
							event.target.value = "";
							if (picked) read(await picked.text());
						}}
					/>
				</div>
				<Textarea
					aria-label="Paste"
					placeholder="Paste the answer or recipe JSON"
					className="kb-import__paste"
					value={text}
					spellCheck={false}
					onChange={(event) => read(event.target.value)}
					aria-invalid={problem ? true : undefined}
				/>
				{problem && (
					<p className="kb-create__error" role="alert">
						{problem}
					</p>
				)}
				{recipe && selection && (
					<RecipePreview recipe={recipe} selection={selection} onChange={setSelection} own={own} />
				)}
			</div>
			<footer className="kb-dialog__footer">
				{tabs}
				<span className="kb-create__spacer" />
				<Button variant="secondary" onClick={onCancel}>
					Cancel
				</Button>
				<Button variant="primary" disabled={!recipe || busy} onClick={() => void create()}>
					Create bot
				</Button>
			</footer>
		</>
	);
}
