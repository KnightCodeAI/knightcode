import { markIntentionalExit, isIntentionalExit } from "./lib/exit-guard"; // must be first
import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { RootLayout } from "./layouts/root-layout";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";

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

import {
  cleanupAllProcesses,
  monitorProcessesHeartbeat,
} from "./lib/tasks/background-tasks";

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

// ── Ctrl+C double-press guard ─────────────────────────────────────────────────
// How OpenTUI exits (confirmed by reading its source):
//   - exitOnCtrlC: false → the keypress handler does NOT destroy. So React's
//     useKeyboard owns the Ctrl+C UX (copy + toast) and fires reliably.
//   - OpenTUI registers exitHandler (→ renderer.destroy()) on SIGINT *and*
//     SIGBREAK. On Windows a single Ctrl+C fires BOTH within a few ms.
//
// We wrap renderer.destroy() as the single choke point:
//   - Intentional exit (/exit command, SIGTERM, confirmed 2nd press): pass through.
//   - First press: record timestamp, swallow. The duplicate signal from the
//     SAME keypress (arriving <80ms later) is collapsed so it can't count as a
//     second press. React shows the "copy / ⌃C again" toast on the same tick.
//   - Genuine 2nd press within 2s: route through handleExit() so the heartbeat
//     interval is cleared (otherwise destroy() blanks the screen but the event
//     loop stays alive → blank-but-not-closed terminal).
const _originalDestroy = renderer.destroy.bind(renderer);

const COLLAPSE_MS = 80; // duplicate signals from one physical keypress
const DOUBLE_PRESS_MS = 2000;
let _lastPressAt = 0;

(renderer as any).destroy = () => {
  if (isIntentionalExit()) {
    clearInterval(heartbeatTimer);
    cleanupAllProcesses();
    _originalDestroy();
    return;
  }
  const now = Date.now();
  const delta = now - _lastPressAt;

  if (delta < COLLAPSE_MS) {
    // Duplicate signal (SIGINT + SIGBREAK) from the same Ctrl+C — ignore.
    return;
  }
  if (delta < DOUBLE_PRESS_MS) {
    // Confirmed second press — clean exit.
    handleExit();
    return;
  }
  // First press — swallow. React's useKeyboard shows the toast on this tick.
  _lastPressAt = now;
};
// ─────────────────────────────────────────────────────────────────────────────

createRoot(renderer).render(<App />);

process.on("exit", () => cleanupAllProcesses());
// SIGTERM (kill / system shutdown) — always immediate; handleExit marks intentional.
process.on("SIGTERM", handleExit);
