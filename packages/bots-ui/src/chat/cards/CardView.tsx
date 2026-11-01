// Picks the component for a card entry. Every card stays answerable while the chat goes on.
import type { Approval, Entry, SkillDraft } from "@knightcode/bots-protocol";
import { McpAppFrame } from "../McpAppFrame.tsx";
import { ApprovalCard, type ApprovalDecision } from "./ApprovalCard.tsx";
import { ConnectAppCard } from "./ConnectAppCard.tsx";
import { HelperCard } from "./HelperCard.tsx";
import { QuestionCard } from "./QuestionCard.tsx";
import { RunSetupCard, SecretRequestCard, SettingsChangeCard, SkillDraftCard } from "./SmallCards.tsx";
import { SuggestionCard } from "./SuggestionCard.tsx";
import { TakeoverCard } from "./TakeoverCard.tsx";

/** What cards can do; the chat view wires these to the socket and the API. */
export interface CardActions {
	answer: (entryId: string, value: string) => void;
	connectApp: (appId: string) => void;
	answerApproval: (approval: Approval, decision: ApprovalDecision) => Promise<void>;
	takeControl: () => void;
	answerSuggestion: (suggestionId: string, accept: boolean) => void;
	undoSettings: (entryId: string) => void;
	saveSkillDraft: (entryId: string, draft: SkillDraft) => void;
	discardSkillDraft: (entryId: string) => void;
	answerSecret: (entryId: string, value: string | undefined) => void;
	runSetup: (skill: string) => void;
	appAction: (entryId: string, action: unknown) => void;
}

type CardEntry = Extract<Entry, { kind: "card" }>;

/** The card for `entry`. */
export function CardView({ entry, actions }: { entry: CardEntry; actions: CardActions }) {
	const card = entry.card;
	switch (card.type) {
		case "question":
			return <QuestionCard card={card} onAnswer={(value) => actions.answer(entry.id, value)} />;
		case "connect-app":
			return <ConnectAppCard card={card} onConnect={() => actions.connectApp(card.appId)} />;
		case "approval":
			return (
				<ApprovalCard
					approval={card.approval}
					onAnswer={(decision) => actions.answerApproval(card.approval, decision)}
				/>
			);
		case "takeover":
			return <TakeoverCard card={card} onTakeControl={actions.takeControl} />;
		case "suggestion":
			return <SuggestionCard card={card} onAnswer={(accept) => actions.answerSuggestion(card.suggestionId, accept)} />;
		case "helper":
			return <HelperCard card={card} />;
		case "skill-draft":
			return (
				<SkillDraftCard
					card={card}
					onSave={(draft) => actions.saveSkillDraft(entry.id, draft)}
					onDiscard={() => actions.discardSkillDraft(entry.id)}
				/>
			);
		case "settings-change":
			return <SettingsChangeCard card={card} onUndo={() => actions.undoSettings(entry.id)} />;
		case "secret-request":
			return <SecretRequestCard card={card} onAnswer={(value) => actions.answerSecret(entry.id, value)} />;
		case "run-setup":
			return <RunSetupCard card={card} onRun={() => actions.runSetup(card.skill)} />;
		case "app-panel":
			return (
				<div className="kb-msg-card" role="group" aria-label={card.title}>
					<section className="kb-msg-card__surface kb-app-panel">
						<McpAppFrame
							appUrl={card.appUrl}
							title={card.title}
							onAction={(action) => actions.appAction(entry.id, action)}
						/>
					</section>
				</div>
			);
	}
}
