/** Loads `knightcode plugin` only when the command runs (see cli.ts). */
export const loadPluginCommand = () => import("./cli.ts");
