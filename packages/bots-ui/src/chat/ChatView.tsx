// A bot's chat: the identity pill that toggles the details pane, the transcript, and the composer, wired to the
// socket (send, stop, answer) and the API (approvals, reactions, files, cards).
import type { Bot, ConversationView } from "@knightcode/bots-protocol";
import { AtSign, CalendarClock, Plug, Sparkles, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { BotAvatarView } from "../avatar/BotAvatarView.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { navigate } from "../shell/routes.ts";
import type { ThreadTarget } from "../state/socket.ts";
import { BOTS, INBOX, useBots, useConversation, useResource, useStore } from "../state/store.ts";
import { Composer, type Draft, type Suggestion } from "./Composer.tsx";
import type { ChatActions } from "./Message.tsx";
import { Transcript } from "./Transcript.tsx";

export interface ChatViewProps {
	bot: Bot;
	paneOpen: boolean;
}

/** The middle column for one bot. */
export function ChatView({ bot, paneOpen }: ChatViewProps) {
	const target = useMemo(() => ({ botId: bot.id }), [bot.id]);
	const view = useConversation(target);
	return (
		<>
			<header className="kb-toolbar" data-ref="toolbar">
				<div role="group" data-ref="chat-header" style={{ display: "flex", justifyContent: "center" }}>
					<span role="heading" aria-level={1} aria-label={bot.name}>
						<button
							type="button"
							className="kb-identity"
							aria-label="View conversation details"
							aria-expanded={paneOpen}
							data-ref="header-identity"
							onClick={() => navigate({ name: "bot", botId: bot.id, pane: paneOpen ? "closed" : "details" })}
						>
							<span className="kb-identity__avatar" data-ref="header-avatar" data-avatar-box="">
								<BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={24} />
							</span>
							<span className="kb-identity__name" data-ref="header-name">
								{bot.name}
							</span>
						</button>
					</span>
				</div>
			</header>
			<Thread target={target} view={view} name={bot.name} botId={bot.id} />
		</>
	);
}

/** The transcript and composer of any thread; group chats reuse it. */
export function Thread({
	target,
	view,
	name,
	botId,
}: {
	target: ThreadTarget;
	view: ConversationView | undefined;
	name: string;
	botId?: string;
}) {
	const store = useStore();
	const toast = useToast();
	const { data } = useBots();
	const bots = useMemo(() => new Map((data?.bots ?? []).map((b) => [b.id, b])), [data]);
	const mentions = useMentions(botId);
	const { data: skillList } = useResource(`skills:${botId ?? "all"}`, (api) => api.listSkills({ botId }));
	const skills = useMemo<Suggestion[]>(
		() =>
			(skillList?.skills ?? []).map((s) => ({
				id: s.id,
				label: s.name,
				detail: s.description,
				kind: "Skill",
				icon: <Sparkles size={14} />,
				insert: `/${s.name}`,
			})),
		[skillList],
	);
	const [context, setContext] = useState<{ replyTo?: { id: string; text: string }; quote?: string; nonce: number }>();
	const refreshBots = () => store.reload(BOTS);

	const actions: ChatActions = {
		answer: (entryId, value) => store.socket.answer(target, entryId, value),
		connectApp: (appId) => navigate({ name: "connectors", appId }),
		answerApproval: async (approval, decision) => {
			const result = await store.api.answerApproval({ id: approval.id, decision });
			store.reload(INBOX);
			refreshBots();
			if (result.result === "expired") toast({ text: "That approval expired. Ask the bot to try again." });
			if (result.result === "changed") toast({ text: "The action changed, so this approval no longer applies." });
		},
		takeControl: () => botId && navigate(`/bots/${encodeURIComponent(botId)}/computer?control=1`),
		answerSuggestion: (id, accept) => void store.api.answerSuggestion({ id, accept }),
		undoSettings: (entryId) => botId && void store.api.undoSettingsChange({ botId, entryId }).then(refreshBots),
		saveSkillDraft: (entryId, draft) =>
			botId &&
			void store.api
				.saveSkillDraft({ botId, entryId, ...draft })
				.then(() => toast({ text: `Saved the skill "${draft.name}"` })),
		discardSkillDraft: (entryId) => botId && void store.api.discardSkillDraft({ botId, entryId }),
		answerSecret: (entryId, value) => botId && void store.api.answerSecretRequest({ botId, entryId, value }),
		runSetup: (skill) => store.socket.submit(target, `/${skill}`),
		testSkillDraft: (draft) => store.socket.submit(target, `Run these steps once, as a test:\n\n${draft.content}`),
		addDraftToRoutine: (draft) =>
			botId && navigate(`/bots/${encodeURIComponent(botId)}/routines/new?skill=${encodeURIComponent(draft.name)}`),
		appAction: (entryId, action) =>
			botId &&
			void store.api
				.appAction({ botId, entryId, action })
				.then((result) => result.approval && toast({ text: "That needs your approval first. It is in the chat." })),
		react: (entryId, emoji) => {
			if ("botId" in target) void store.api.react({ botId: target.botId, entryId, emoji });
			else void store.api.reactInGroup({ groupId: target.groupId, entryId, emoji });
		},
		reply: (entry) => setContext({ replyTo: { id: entry.id, text: entry.text.slice(0, 80) }, nonce: Date.now() }),
		quote: (text) => setContext({ quote: text.slice(0, 500), nonce: Date.now() }),
	};

	const send = async (text: string, draft: Draft) => {
		const attachments = await Promise.all(
			draft.files.map(
				async (file) =>
					(
						await store.api.uploadFile({
							name: file.name,
							mime: file.type || "application/octet-stream",
							kind: "attachment",
							botId,
							data: await toBase64(file),
						})
					).id,
			),
		);
		store.socket.submit(target, text, {
			attachments: attachments.length ? attachments : undefined,
			replyTo: draft.replyTo?.id,
			quote: draft.quote,
		});
	};

	return (
		<>
			<Transcript view={view} bots={bots} botId={botId} botName={name} actions={actions} />
			<Composer
				placeholder={`Message ${name}`}
				running={view?.running ?? false}
				onSend={(text, draft) => void send(text, draft)}
				onStop={() => store.socket.stop(target)}
				mentions={mentions}
				skills={skills}
				context={context}
			/>
		</>
	);
}

/** Everything "@" can name: the user's other bots, group chats, routines and connected apps. */
function useMentions(currentBot: string | undefined): Suggestion[] {
	const { data } = useBots();
	const { data: routines } = useResource("routines:all", (api) => api.listRoutines({}));
	const { data: catalog } = useResource("catalog", (api) => api.listCatalog({}));
	return useMemo(() => {
		const list: Suggestion[] = [];
		for (const bot of data?.bots ?? [])
			if (bot.id !== currentBot && !bot.archived)
				list.push({
					id: `bot:${bot.id}`,
					label: bot.name,
					detail: bot.purpose,
					kind: "Bot",
					icon: <BotAvatarView shape={bot.avatar.shape} color={bot.avatar.color} size={16} />,
					insert: `@${bot.name}`,
				});
		for (const group of data?.groups ?? [])
			list.push({
				id: `group:${group.id}`,
				label: group.name,
				detail: `${group.memberIds.length} bots`,
				kind: "Group",
				icon: <Users size={14} />,
				insert: `@${group.name}`,
			});
		for (const routine of routines?.routines ?? [])
			if (routine.botId === currentBot)
				list.push({
					id: `routine:${routine.id}`,
					label: routine.name,
					detail: routine.active ? "on" : "paused",
					kind: "Routine",
					icon: <CalendarClock size={14} />,
					insert: `@${routine.name}`,
				});
		for (const app of catalog?.entries ?? [])
			if (app.connection)
				list.push({
					id: `app:${app.id}`,
					label: app.name,
					detail: app.connection.status === "connected" ? "connected" : "needs auth",
					kind: "App",
					icon: <Plug size={14} />,
					insert: `@${app.name}`,
				});
		if (list.length === 0)
			list.push({ id: "none", label: "everyone", kind: "Everyone", icon: <AtSign size={14} />, insert: "@everyone" });
		return list;
	}, [data, routines, catalog, currentBot]);
}

async function toBase64(file: File): Promise<string> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}
