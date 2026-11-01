// Open work: a short list of things the bot started and has not finished. The user can add, complete or remove items.
import type { Bot } from "@knightcode/bots-protocol";
import { X } from "lucide-react";
import { useState } from "react";
import { Input } from "../primitives/Input.tsx";
import { useResource, useStore } from "../state/store.ts";

/** The checklist with an add field. */
export function OpenWork({ bot }: { bot: Bot }) {
	const store = useStore();
	const key = `open-work:${bot.id}`;
	const { data } = useResource(key, (api) => api.listOpenWork({ botId: bot.id }));
	const [text, setText] = useState("");
	const refresh = () => store.reload(key);
	const items = data?.items ?? [];
	return (
		<div className="kb-open-work">
			{items.length === 0 && <p className="kb-settings__hint">Nothing open.</p>}
			<ul className="kb-open-work__list" aria-label="Open work">
				{items.map((item) => (
					<li key={item.id} className="kb-open-work__item">
						<label className="kb-recipe__check">
							<input
								type="checkbox"
								checked={item.done}
								onChange={(event) =>
									void store.api
										.updateOpenWork({ botId: bot.id, id: item.id, done: event.target.checked })
										.then(refresh)
								}
							/>
							<span className={item.done ? "kb-open-work__done" : undefined}>{item.text}</span>
						</label>
						<button
							type="button"
							className="kb-chip__remove"
							aria-label={`Remove ${item.text}`}
							onClick={() => void store.api.deleteOpenWork({ botId: bot.id, id: item.id }).then(refresh)}
						>
							<X size={12} />
						</button>
					</li>
				))}
			</ul>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const trimmed = text.trim();
					if (!trimmed) return;
					void store.api.addOpenWork({ botId: bot.id, text: trimmed }).then(refresh);
					setText("");
				}}
			>
				<Input
					aria-label="Add open work"
					placeholder="Add something to track"
					value={text}
					onChange={(event) => setText(event.target.value)}
				/>
			</form>
		</div>
	);
}
