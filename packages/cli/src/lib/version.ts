/**
 * The CLI version. In the compiled binary `KNIGHTCODE_VERSION` is substituted by
 * Bun.build({ define }); in dev it is undeclared, so we fall back to a dev marker.
 */
export const VERSION: string =
  typeof KNIGHTCODE_VERSION !== "undefined" ? KNIGHTCODE_VERSION : "0.0.0-dev";
