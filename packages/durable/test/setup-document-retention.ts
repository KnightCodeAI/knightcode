// Loaded by vitest for every test file: `KNIGHTCODE_DURABLE_DOCUMENT_RETENTION_MS` sets the document retention of every Session
// that keeps the default, so the suite can run with each unattached document evicted right after use
// (the second pass of `bun run test`).
import { setDefaultDocumentRetention } from "../src/session/session.ts";

const forced = process.env.KNIGHTCODE_DURABLE_DOCUMENT_RETENTION_MS;
if (forced !== undefined) setDefaultDocumentRetention(Number(forced));
