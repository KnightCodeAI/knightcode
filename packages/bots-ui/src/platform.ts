// Where the UI runs. The desktop app owns the window's address, theme and session; the web app owns them itself.
import { createContext, useContext } from "react";

export type Platform = "web" | "desktop";

export const PlatformContext = createContext<Platform>("web");

export const usePlatform = () => useContext(PlatformContext);

/** What only the desktop app can do, handed in by it: "Let bots use this computer". */
export interface DesktopHost {
	computerAccess: { enabled(): Promise<boolean>; set(enabled: boolean): Promise<boolean> };
}

export const DesktopHostContext = createContext<DesktopHost | undefined>(undefined);

export const useDesktopHost = () => useContext(DesktopHostContext);
