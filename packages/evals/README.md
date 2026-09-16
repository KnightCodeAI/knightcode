# KnightCode evals

Behavioral evals for KnightCode's coding agent, built with `vitest-evals`.

## File conventions

Eval definitions are flat under `evals/`:

- `*.docs.eval.ts` is a documentation-lift eval. `eval:docs` runs each case twice, once `without_docs` and once `with_docs`, and reports the lift between the two.
- Other `*.eval.ts` files are host evals. `eval:host` runs them with Vitest. They are ordinary vitest-evals suites, not paired comparisons.

Runner code lives in `src/`:

- `cli.ts` orchestrates a comparison
- `runner.ts` discovers cases and runs one arm
- `plan.ts` expands cases into `(case, variant, run)` tasks
- `report.ts` reads Vitest JSON, pairs arms, and computes lift
- `harness.ts` is the vitest-evals adapter

## Run evals

Host evals and documentation-lift evals both need `KNIGHTCODE_PROVIDER` and `KNIGHTCODE_MODEL`.

```bash
KNIGHTCODE_PROVIDER=openrouter KNIGHTCODE_MODEL=anthropic/claude-haiku-4.5 bun run eval
```

That runs the host evals, then the documentation comparison. Extra flags after `--` go to `eval:docs` only.

Authentication comes from KnightCode's normal `ModelRuntime`. The runner also loads the repository's `.env`, so a key kept there (`OPENROUTER_API_KEY`, ...) is picked up without exporting it.

Host evals only:

```bash
KNIGHTCODE_PROVIDER=openrouter KNIGHTCODE_MODEL=anthropic/claude-haiku-4.5 \
  bun run --filter '@knightcode/evals' eval:host -- evals/documentation-audit.eval.ts
```

## Run documentation comparisons

```bash
bun run --filter '@knightcode/evals' eval:docs -- \
  --provider openrouter \
  --model anthropic/claude-haiku-4.5
```

`KNIGHTCODE_PROVIDER` and `KNIGHTCODE_MODEL` provide the same defaults. Both values are required.

The default is one run per variant. Increase it explicitly when measuring stability:

```bash
bun run --filter '@knightcode/evals' eval:docs -- \
  evals/extensions.docs.eval.ts \
  --runs-per-variant 5
```

`KNIGHTCODE_EVAL_RUNS_PER_VARIANT=5` is equivalent. Vitest filters are applied during discovery:

```bash
bun run --filter '@knightcode/evals' eval:docs -- -t "adds the model"
```

The runner:

1. Discovers the selected cases in both variants and requires identical cohorts.
2. Plans every `(case, variant, model, runNumber)` arm before execution.
3. Runs each arm in its own Vitest process. A failed or missing arm is recorded and the planned cohort continues.
4. Reads native Vitest JSON through `@vitest-evals/core/node` when a report exists.
5. Pairs exact arms and writes the comparison report. Blocked pairs withhold headline lift; the process exits nonzero.

Run order alternates by run number to reduce order bias.

## Documentation variants

`without_docs` removes the KnightCode documentation-routing section from the default system prompt, so the agent is never told where the documentation lives. `with_docs` uses the unchanged default prompt.

Every run gets a fresh home, agent directory, workspace and session directory, and the process environment is redirected at them for the duration. Documentation evals allow only `read`, `write`, `edit`, `grep`, `find` and `ls`; they expose neither shell nor web-search tools.

A hidden guard extension blocks tool calls that would leave the eval directory: `write` and `edit` may only touch files under the run's temporary root, and shell commands may not name the repository or the real user's configuration directory. The workspace is a temporary directory, not a sandbox — an agent that cannot find the documentation goes looking, and without the guard it finds this repository.

## Results

Each invocation creates an ignored `.eval/<timestamp>_<id>/` directory containing:

- `protocol.json`: model, cases, tasks, and protocol digest.
- `expected-runs.json`: the complete planned cohort.
- `observations.jsonl`: normalized outcomes and telemetry.
- `tasks/*/vitest.json`: native JSON for each arm.
- `<variant>/sessions/*/session.jsonl`: native KnightCode sessions.
- `report.json` and `report.txt`: paired comparisons.

A pair contributes to pass-rate lift only when both arms produce exactly one score. Missing, duplicate, skipped, pending, unscored, or errored arms block the pair. If any pair in an eval set is blocked, headline pass rates are withheld. Missing telemetry remains unavailable rather than being treated as zero.

The report flags no lift, negative deltas, saturated controls or treatments, and observed flakiness. One run per variant cannot establish stability.

Artifacts may contain prompts, responses, generated code, and tool output.

## Write an eval

Use one ordinary `describeEval(...)` suite and one explicit `run(...)` call per case:

```ts
import { describeEval, StructuredOutputJudge } from "vitest-evals";
import { createDocumentationEvalHarness } from "../src/harness.ts";

const harness = createDocumentationEvalHarness();
const judge = StructuredOutputJudge({ expected: { ok: true }, match: "strict", allowExtras: false });

describeEval("Target workflow", { harness, judges: [judge], judgeThreshold: null }, (it) => {
  it("completes the task", async ({ run }) => {
    await run("Complete the target task.");
  });
});
```

The outer runner owns variants, repetitions, isolation, identity, persistence, and reporting. Eval files should contain only scenario setup, the model task, and deterministic grading.

Use `judgeThreshold: null` for comparative scoring. A low score is data, not an infrastructure failure. Reserve Vitest assertions for broken suite invariants.
