import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { Header } from "./components/header";
import { InputBar } from "./components/input-bar";
import { RootLayout } from "./layouts/root-layout";
import { useTheme } from "./providers/theme";
import { Home } from "./screens/home";
import { NewSession } from "./screens/new-session";
import { Session } from "./screens/session";

function ThemedRoot() {
  const { colors } = useTheme();

  return (
    <box
      alignItems="center"
      justifyContent="center"
      width="100%"
      height="100%"
      gap={2}
      backgroundColor={colors.background}
    >
      <Header />
      <box width="100%" maxWidth={78} paddingX={2}>
        <InputBar onSubmit={() => {}} />
      </box>
    </box>
  );
}

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
  targetFps: 120,
  exitOnCtrlC: false,
});
createRoot(renderer).render(<App />);
