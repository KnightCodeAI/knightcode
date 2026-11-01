// Keeps one broken piece of content (a widget with malformed data, a message that fails to render) from blanking the
// whole app: that piece shows a short notice instead.
import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
	override state = { failed: false };

	static getDerivedStateFromError(): { failed: boolean } {
		return { failed: true };
	}

	override render(): ReactNode {
		return this.state.failed ? this.props.fallback : this.props.children;
	}
}
