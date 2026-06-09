// Build-time constants substituted by Bun.build({ define }) in scripts/build.ts.
// Undeclared at runtime in dev — always read behind a `typeof … !== "undefined"`
// guard so the dev fallback path runs without a ReferenceError.
declare const KNIGHTCODE_VERSION: string;
declare const KNIGHTCODE_MIGRATIONS:
  | { id: string; hash: string; sql: string }[]
  | undefined;
