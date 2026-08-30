"""Harbor / Terminal-Bench adapter for KnightCode.

Uploads the locally built linux-x64 binary into each task container and drives it
in headless JSON mode, so a run measures the working tree rather than whatever was
last published to npm.

Use `bun run bench` — it builds the binary, sets PYTHONPATH, and forwards flags to
`harbor run`. To call harbor directly, repo root must be importable:

    PYTHONPATH=. harbor run -d terminal-bench/terminal-bench \
      -a bench.knightcode_agent:KnightCode \
      -m openrouter/deepseek/deepseek-v4-flash-0731 -n 4

A model that already exists in KnightCode's catalog runs on the built-in entry —
its context window, thinking-level map, compat flags and cost data all apply. The
models.json branch below only fires when harbor points at an endpoint the catalog
does not know, and a hand-written entry carries none of that, so prefer catalog ids.

Agent kwargs (--ak):
    model_api        models.json `api` id for an off-catalog endpoint
                     (openai-completions, anthropic-messages, …)
    context_window   token budget for that off-catalog entry (default 200000)
    thinking         off | minimal | low | medium | high | xhigh | max

Env:
    KNIGHTCODE_BENCH_BIN_DIR   override the directory holding the built binary
"""

import json
import os
import shlex
from pathlib import Path, PurePosixPath
from typing import Any, override

from harbor.agents.installed.base import BaseInstalledAgent, CliFlag, with_prompt_template
from harbor.agents.model_connection import ModelConnectionSpec, ResolvedModelConnection
from harbor.environments.base import BaseEnvironment
from harbor.models.agent.context import AgentContext

_REPO_ROOT = Path(__file__).resolve().parents[1]
_LOCAL_BIN_DIR = Path(
    os.environ.get("KNIGHTCODE_BENCH_BIN_DIR")
    or _REPO_ROOT / "packages" / "cli-linux-x64" / "bin"
)

_REMOTE_DIR = PurePosixPath("/opt/knightcode")
_REMOTE_BIN = _REMOTE_DIR / "knightcode"
_CONFIG_DIR_ENV = "KNIGHTCODE_CODING_AGENT_DIR"
_REMOTE_CONFIG_DIR = PurePosixPath("/tmp/harbor-knightcode-agent")
_CUSTOM_PROVIDER = "harbor-endpoint"
_MESSAGE_UPDATE_FILTER = '\'"type":"message_update"\''


class KnightCode(BaseInstalledAgent):
    SUPPORTS_RESUME: bool = True
    MODEL_CONNECTION = ModelConnectionSpec(passthrough=True)

    _OUTPUT_FILENAME = "knightcode.txt"

    CLI_FLAGS = [
        CliFlag(
            "thinking",
            cli="--thinking",
            type="enum",
            choices=["off", "minimal", "low", "medium", "high", "xhigh", "max"],
        ),
    ]

    def __init__(
        self,
        *args,
        model_api: str | None = None,
        context_window: int = 200_000,
        **kwargs,
    ):
        super().__init__(*args, **kwargs)
        self._model_api = (model_api or "").strip() or None
        # A models.json entry without contextWindow resolves to 0, which disables
        # auto-compaction outright (core/agent-session.ts shouldCompact).
        self._context_window = int(context_window)

    @staticmethod
    @override
    def name() -> str:
        return "knightcode"

    @override
    def get_version_command(self) -> str | None:
        return f"{_REMOTE_BIN} --version"

    @override
    def parse_version(self, stdout: str) -> str:
        return stdout.strip().splitlines()[-1].strip()

    @override
    async def install(self, environment: BaseEnvironment) -> None:
        if not (_LOCAL_BIN_DIR / "knightcode").is_file():
            raise FileNotFoundError(
                f"No KnightCode binary at {_LOCAL_BIN_DIR}. "
                "Run: bun run scripts/build.ts --target=linux-x64"
            )
        # The compiled binary resolves package.json, theme/ and assets/ relative
        # to itself (config.ts getPackageDir), so the whole dir has to travel.
        await environment.upload_dir(_LOCAL_BIN_DIR, _REMOTE_DIR.as_posix())
        await self.exec_as_root(
            environment,
            command=f"chmod -R a+rX {_REMOTE_DIR} && chmod a+rx {_REMOTE_BIN}",
        )

    @staticmethod
    def _api_key_env_name(access: ResolvedModelConnection) -> str | None:
        if access.api_key is None:
            return None
        return next(
            (name for name, value in sorted(access.env.items()) if value == access.api_key),
            None,
        )

    def _build_custom_models_json(
        self, access: ResolvedModelConnection, model_id: str
    ) -> dict[str, Any] | None:
        endpoint = access.configured_base_url
        if endpoint is None:
            if self._model_api is not None:
                raise ValueError("model_api requires an explicitly configured base URL")
            return None
        if self._model_api is None:
            raise ValueError("Custom endpoints require the model_api agent argument")

        api_key_env = self._api_key_env_name(access)
        if api_key_env is None:
            raise ValueError(
                "Custom endpoints require an API-key environment-variable reference"
            )

        return {
            "providers": {
                _CUSTOM_PROVIDER: {
                    "baseUrl": endpoint,
                    "apiKey": f"${api_key_env}",
                    "api": self._model_api,
                    "models": [{"id": model_id, "contextWindow": self._context_window}],
                }
            }
        }

    async def _write_custom_models_json(
        self, environment: BaseEnvironment, models_json: dict[str, Any]
    ) -> None:
        models_path = (_REMOTE_CONFIG_DIR / "models.json").as_posix()
        await self.exec_as_agent(
            environment,
            command=f"mkdir -p {shlex.quote(_REMOTE_CONFIG_DIR.as_posix())}",
        )
        await self._upload_config_text(
            environment,
            content=json.dumps(models_json, indent=2) + "\n",
            remote_path=models_path,
            filename="models.json",
        )

    @override
    @with_prompt_template
    async def run(
        self, instruction: str, environment: BaseEnvironment, context: AgentContext
    ) -> None:
        if not self.model_name or "/" not in self.model_name:
            raise ValueError("Model name must be in the format provider/model_name")

        provider, model_id = self.model_name.split("/", 1)
        access = self.model_connection
        provider = access.provider or provider
        env = dict(access.env)
        if provider == "anthropic" and (token := self._get_env("ANTHROPIC_OAUTH_TOKEN")):
            env["ANTHROPIC_OAUTH_TOKEN"] = token

        models_json = self._build_custom_models_json(access, model_id)
        config_prefix = ""
        if models_json is not None:
            await self._write_custom_models_json(environment, models_json)
            config_prefix = (
                f"{_CONFIG_DIR_ENV}={shlex.quote(_REMOTE_CONFIG_DIR.as_posix())} "
            )
            provider = _CUSTOM_PROVIDER

        if self.skills_dir:
            await self.exec_as_agent(
                environment,
                command=(
                    "mkdir -p $HOME/.agents/skills && "
                    f"cp -r {shlex.quote(self.skills_dir)}/* "
                    "$HOME/.agents/skills/ 2>/dev/null || true"
                ),
            )

        cli_flags = self.build_cli_flags()
        if cli_flags:
            cli_flags += " "

        await self.exec_as_agent(
            environment,
            command=(
                "mkdir -p /logs/agent/knightcode/sessions && "
                f"{config_prefix}{_REMOTE_BIN} --print --mode json "
                "--session-dir /logs/agent/knightcode/sessions "
                f"{'--continue ' if self._resume else ''}"
                f"--provider {provider} --model {model_id} "
                f"{cli_flags}"
                f"{shlex.quote(instruction)} "
                f"2>&1 </dev/null | grep -v {_MESSAGE_UPDATE_FILTER} "
                f"| stdbuf -oL tee /logs/agent/{self._OUTPUT_FILENAME}"
            ),
            env=env,
        )

    @override
    def populate_context_post_run(self, context: AgentContext) -> None:
        output_file = self.logs_dir / self._OUTPUT_FILENAME
        if not output_file.exists():
            return

        totals = {"input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0}
        total_cost = 0.0
        for line in output_file.read_text().splitlines():
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError:
                continue
            if event.get("type") != "message_end":
                continue
            message = event.get("message") or {}
            if message.get("role") != "assistant":
                continue
            usage = message.get("usage") or {}
            for key in totals:
                totals[key] += usage.get(key, 0)
            total_cost += (usage.get("cost") or {}).get("total", 0.0)

        context.n_input_tokens = totals["input"] + totals["cacheRead"]
        context.n_output_tokens = totals["output"]
        context.n_cache_tokens = totals["cacheRead"]
        context.cost_usd = total_cost if total_cost > 0 else None
