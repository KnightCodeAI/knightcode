# Core OpenRouter Transport (reseed Phase B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
> Uncommitted doc (workflow rule). Branch: `core` (local-only until the core is shippable; user decides when to PR).

**Goal:** `knightcode --next` runs real model turns: OpenRouter SSE in, Anthropic Beta stream events out, rendered by the existing core loop/UI.

**Architecture:** Three units behind the existing `ModelTransport` seam — (1) `openai-format.ts`: pure outbound translation (system prompt + `BetaMessageParam[]` + `ToolSchema[]` → OpenAI chat-completions request shapes); (2) `event-translator.ts`: pure inbound `ChunkTranslator` folding OpenAI stream chunks into ordered `BetaRawMessageStreamEvent`s (text, reasoning→thinking, tool-call partial JSON, finish reasons, usage); (3) `openrouter.ts`: `OpenRouterTransport` doing fetch + SSE line parsing, delegating to the translator, with injectable `fetchImpl` for tests. `StreamAccumulator` learns `thinking_delta`; the transcript renders thinking rows dim. `CoreApp` picks the real transport when a key exists (env/credentials), else falls back to loopback with a visible notice; tests always inject transports explicitly (the repo `.env` may hold a real key — tests must never hit the network).

**Clean-room note:** prompts and user-facing strings authored fresh; system prompt is a minimal placeholder this phase.

---

### Task 1: Outbound translation (`openai-format.ts`)
- `toOpenAIMessages(systemPrompt, messages)`: system → `{role:"system"}`; user text (string or text blocks) → `{role:"user"}`; user `tool_result` blocks → one `{role:"tool", tool_call_id, content}` each, in block order; assistant text joins to `content`, assistant `tool_use` blocks → `tool_calls[{id,type:"function",function:{name,arguments:JSON.stringify(input)}}]`; thinking blocks dropped.
- `toOpenAITools(tools)`: `{type:"function", function:{name,description,parameters}}`.
- TDD: tests for each mapping incl. mixed user content and empty-assistant-text-with-tools.

### Task 2: Inbound translation (`event-translator.ts`)
- `ChunkTranslator.handleChunk(chunk): events[]` + `.finish(): events[]`.
- First chunk → `message_start` (id/model from chunk, zeroed usage). `delta.reasoning` → thinking block; `delta.content` → text block (closing any open block of another kind); `delta.tool_calls[i]` keyed by `index` → `tool_use` `content_block_start` then `input_json_delta` fragments. `finish_reason` and `usage` retained; `finish()` closes the open block, emits `message_delta` (`stop` → `end_turn`, `tool_calls` → `tool_use`, `length` → `max_tokens`, `content_filter` → `refusal`; usage `prompt_tokens/completion_tokens` → `input_tokens/output_tokens`) then `message_stop`.
- TDD: text-only; reasoning+text; split tool-call args reassemble through `StreamAccumulator` (integration assert on final message); finish-reason map; usage mapping.

### Task 3: `OpenRouterTransport`
- Ctor: `{apiKey, model-agnostic; baseUrl?, fetchImpl?, referer headers}`. `stream(request)`: POST `chat/completions` `{model, messages, tools?, stream:true, usage:{include:true}}`, abort via `request.signal`; non-2xx → throw with response text; SSE parse (`data: ` lines, ignore `:` comments, stop at `[DONE]`), yield translator events; error chunks (`{error}`) → throw.
- TDD with `fetchImpl` returning a `ReadableStream` SSE fixture; abort mid-stream test.

### Task 4: Accumulator + transcript thinking support
- `StreamAccumulator`: handle `thinking_delta` on thinking blocks.
- `transcriptRows`: thinking blocks → `{kind:"thinking"}` rows; `TranscriptView` renders them dim italic.

### Task 5: Wiring
- `CoreApp` props `{transport?, modelId?, notice?}`; default resolution: `KNIGHTCODE_LOOPBACK=1` or missing key → loopback + notice system row ("No OpenRouter API key found — loopback mode…"), else `OpenRouterTransport` + `DEFAULT_CHAT_MODEL_ID`. Minimal system prompt for real turns. `BrandHeader` second line shows model id or the loopback hint.
- Boot smoke passes the loopback transport explicitly (deterministic, offline).

### Task 6: Verify + single clean commit
- `bun run check-types`, `bun test` (all green); grep diff for process-speak (none); manual real-key smoke is the user's; one commit on `core` (no push).
