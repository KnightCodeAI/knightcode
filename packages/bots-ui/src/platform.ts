// Where the UI runs. The desktop app owns the window's address, theme and session; the web app owns them itself.
import { createContext, useContext } from "react";

export type Platform = "web" | "desktop";

export const PlatformContext = createContext<Platform>("web");

export const usePlatform = () => useContext(PlatformContext);
