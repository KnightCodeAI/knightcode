// Tasks: work items a bot or the user created, and each bot's open work. Add, complete, or reopen them.
import type { Bot, Task } from "@knightcode/bots-protocol";
import { useState } from "react";
import { formatDay } from "../chat/layout.ts";
import { Input } from "../primitives/Input.tsx";
import { INBOX, useStore } from "../state/store.ts";

/** Open tasks first, then done ones; the field adds one owned by the user. */
export function TaskList({ tasks, bots }: { tasks: Task[]; bots: Bot[] }) {
	const store = useStore();
	const [title, setTitle] = useState("");
	const sorted = [...tasks].sort(
		(a, b) => Number(a.status === "done") - Number(b.status === "done") || (a.due ?? Infinity) - (b.due ?? Infinity),
	);
	const refresh = () => store.reload(INBOX);
	return (
		<section className="kb-inbox__group" aria-label="Tasks">
			<h2 className="kb-inbox__group-title">Tasks</h2>
			<ul className="kb-list">
				{sorted.map((task) => {
					const owner = bots.find((b) => b.id === task.ownerBotId);
					return (
						<li key={task.id} className="kb-task">
							<label className="kb-recipe__check">
								<input
									type="checkbox"
									checked={task.status === "done"}
									onChange={(e) =>
										void store.api.updateTask({ id: task.id, status: e.target.checked ? "done" : "open" }).then(refresh)
									}
								/>
								<span className={task.status === "done" ? "kb-open-work__done" : undefined}>
									{task.title}
									<span className="kb-list__meta">
										{" "}
										· {owner ? owner.name : "You"}
										{task.source === "open-work" ? " · open work" : ""}
										{task.due ? ` · due ${formatDay(task.due)}` : ""}
									</span>
								</span>
							</label>
						</li>
					);
				})}
			</ul>
			<form
				onSubmit={(event) => {
					event.preventDefault();
					const trimmed = title.trim();
					if (!trimmed) return;
					void store.api.createTask({ title: trimmed }).then(refresh);
					setTitle("");
				}}
			>
				<Input
					aria-label="Add a task"
					placeholder="Add a task"
					value={title}
					onChange={(e) => setTitle(e.target.value)}
				/>
			</form>
		</section>
	);
}
