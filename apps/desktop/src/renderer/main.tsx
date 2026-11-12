import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import { initializeDesktopExtensions } from "./extensions/host.tsx";
import "./styles.css";

const disposeExtensions = initializeDesktopExtensions();
import.meta.hot?.dispose(disposeExtensions);

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
