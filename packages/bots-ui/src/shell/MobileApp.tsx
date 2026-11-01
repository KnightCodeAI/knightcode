// "Get Bots for mobile": the web app installs to a phone's home screen, so this says how.
import { Copy } from "lucide-react";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";

export function MobileApp({ onClose }: { onClose: () => void }) {
	const address = location.host;
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Get Bots for mobile"
			width={420}
			footer={
				<Button variant="primary" onClick={onClose}>
					Done
				</Button>
			}
		>
			<div className="kb-dialog__body kb-mobile-app">
				<p>Open this address on your phone, then add it to your Home Screen.</p>
				<div className="kb-mobile-app__address">
					<span>{address}</span>
					<button
						type="button"
						className="kb-hover-actions__button"
						aria-label="Copy the address"
						onClick={() => void navigator.clipboard?.writeText(`https://${address}`)}
					>
						<Copy size={14} />
					</button>
				</div>
				<p className="kb-set-row__hint">
					iPhone: Share, then Add to Home Screen. Android: the browser menu, then Install app. Notifications reach the
					phone once it is added.
				</p>
			</div>
		</Dialog>
	);
}
