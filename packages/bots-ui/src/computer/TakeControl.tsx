// Taking exclusive control of a bot's screen (to sign in or solve a check); releasing it lets the bot carry on.
import { Hand } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { ProtectedInput } from "./ProtectedInput.tsx";

/** The toolbar button that takes control. */
export function TakeControlButton({ onTake }: { onTake: () => void }) {
	return (
		<button type="button" className="kb-screen__tool" aria-label="Take control" onClick={onTake}>
			<Hand size={16} strokeWidth={1.75} />
		</button>
	);
}

/** While the user has control: a banner over the screen with Release, and a safe way to type secrets. */
export function ControlBanner({ botId, onRelease }: { botId: string; onRelease: () => void }) {
	return (
		<div className="kb-control">
			<div className="kb-control__banner" role="status">
				<span className="kb-control__dot" aria-hidden />
				You have control
				<Button variant="primary" size="sm" onClick={onRelease}>
					Release control
				</Button>
			</div>
			<ProtectedInput botId={botId} />
		</div>
	);
}
