/**
 * Worker entry for the codemode sandbox in bundled builds. The Node bundle and the Bun binary
 * build this file as a separate entrypoint because the codemode package's worker file is not on disk
 * there; `getCodemodeWorkerUrl()` in config.ts resolves it.
 */
import "@knightcode/codemode/worker";
