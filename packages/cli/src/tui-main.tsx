import { markIntentionalExit, isIntentionalExit } from "./lib/exit-guard"; // must be first
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";
import {
  cleanupAllProcesses,
  monitorProcessesHeartbeat,
} from "./lib/tasks/background-tasks";

const router = createMemoryRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      {
        index: true,
        element: <Home />,
      },
      {
        path: "sessions/new",
        element: <NewSession />,
      },
      {
        path: "sessions/:id",
        element: <Session />,
      },
    ],
  },
]);

function App() {
  return <RouterProvider router={router} />;
}

const renderer = await createCliRenderer({
  targetFps: 60,
  exitOnCtrlC: false,
});

// Register cleanup before anything that could fail (heartbeat, render) so a
// crash during startup still tears down spawned processes on exit.
process.on("exit", () => cleanupAllProcesses());

// Start process heartbeat monitor
const heartbeatTimer = setInterval(() => {
  monitorProcessesHeartbeat();
}, 5000);

// Clean, intentional exit: clears the heartbeat (which otherwise keeps the
// event loop alive after destroy) and tears down the renderer.
function handleExit() {
  clearInterval(heartbeatTimer);
  cleanupAllProcesses();
  markIntentionalExit();
  _originalDestroy();
}

// ── Ctrl+C cannot quit the app ────────────────────────────────────────────────
// The ONLY way to exit is the /exit command, which calls markIntentionalExit()
// before renderer.destroy(). OpenTUI routes Ctrl+C (SIGINT, plus SIGBREAK on
// Windows) through renderer.destroy(), so we wrap it as the single choke point
// and swallow every destroy() that wasn't explicitly marked intentional. This
// neutralizes both the signal handlers and any stray React-side destroy call.
const _originalDestroy = renderer.destroy.bind(renderer);

(renderer as any).destroy = () => {
  if (!isIntentionalExit()) return;
  clearInterval(heartbeatTimer);
  cleanupAllProcesses();
  _originalDestroy();
};
// ─────────────────────────────────────────────────────────────────────────────

// SIGTERM (kill / system shutdown) — always immediate; handleExit marks
// intentional. Registered before first render so a render-time crash is covered.
process.on("SIGTERM", handleExit);

createRoot(renderer).render(<App />);
