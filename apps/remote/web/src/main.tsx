import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";
import "./index.css";

// No StrictMode: its double-invoked effects would open the room websocket twice in dev,
// which is exactly the behaviour this app is here to observe.
const root = document.getElementById("root");
if (!root) throw new Error("Missing #root");
createRoot(root).render(<App />);
