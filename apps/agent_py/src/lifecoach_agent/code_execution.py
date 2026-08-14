"""Bounded, read-only code execution through Cloud Run Sandboxes."""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import signal
import tempfile
from pathlib import Path
from typing import Any

from google.adk.tools.function_tool import FunctionTool

RUN_ANALYSIS_TOOL_NAME = "run_analysis"
DEFAULT_SANDBOX_LAUNCHER = "/usr/local/gcp/bin/sandbox"
MAX_CODE_BYTES = 12 * 1024
MAX_INPUT_BYTES = 64 * 1024
MAX_OUTPUT_BYTES = 64 * 1024


class _OutputTooLarge(Exception):
    pass


class CloudRunSandboxExecutor:
    def __init__(
        self,
        *,
        launcher: str = DEFAULT_SANDBOX_LAUNCHER,
        timeout_s: float = 20.0,
    ) -> None:
        self.launcher = launcher
        self.timeout_s = timeout_s

    @property
    def available(self) -> bool:
        return Path(self.launcher).is_file() and os.access(self.launcher, os.X_OK)

    async def execute(self, *, code: str, input_json: str) -> dict[str, Any]:
        code_bytes = code.encode("utf-8")
        input_bytes = input_json.encode("utf-8")
        if len(code_bytes) > MAX_CODE_BYTES:
            return _error("code_too_large", f"Code exceeds {MAX_CODE_BYTES} bytes")
        if len(input_bytes) > MAX_INPUT_BYTES:
            return _error("input_too_large", f"Input exceeds {MAX_INPUT_BYTES} bytes")
        try:
            parsed_input = json.loads(input_json)
        except json.JSONDecodeError:
            return _error("invalid_input", "input_json must contain valid JSON")
        if not isinstance(parsed_input, dict | list):
            return _error("invalid_input", "input_json must contain a JSON object or array")
        if not self.available:
            return _error("unavailable", "Sandbox execution is not available")

        with tempfile.TemporaryDirectory(prefix="lifecoach-analysis-") as temp_dir:
            work = Path(temp_dir)
            (work / "main.py").write_bytes(code_bytes)
            (work / "input.json").write_bytes(input_bytes)
            mount = f"type=bind,source={work},destination=/mnt/input,readonly"
            proc = await asyncio.create_subprocess_exec(
                self.launcher,
                "do",
                "--write",
                "--mount",
                mount,
                "--",
                "/usr/local/bin/python3",
                "/mnt/input/main.py",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
            assert proc.stdout is not None
            assert proc.stderr is not None
            stdout_task = asyncio.create_task(_read_bounded(proc.stdout, MAX_OUTPUT_BYTES))
            stderr_task = asyncio.create_task(_drain(proc.stderr))
            wait_task = asyncio.create_task(proc.wait())
            try:
                async with asyncio.timeout(self.timeout_s):
                    stdout = await stdout_task
                    await wait_task
                    await stderr_task
            except _OutputTooLarge:
                await _kill_process_group(proc)
                _audit("output_too_large", len(code_bytes), len(input_bytes), 0, proc.returncode)
                return _error("output_too_large", f"Output exceeds {MAX_OUTPUT_BYTES} bytes")
            except TimeoutError:
                await _kill_process_group(proc)
                _audit("timeout", len(code_bytes), len(input_bytes), 0, None)
                return _error("timeout", f"Analysis exceeded {self.timeout_s:g}s")
            finally:
                for task in (stdout_task, stderr_task, wait_task):
                    task.cancel()
                await asyncio.gather(stdout_task, stderr_task, wait_task, return_exceptions=True)

        if proc.returncode != 0:
            _audit(
                "execution_failed", len(code_bytes), len(input_bytes), len(stdout), proc.returncode
            )
            return _error("execution_failed", "Analysis code failed", exit_code=proc.returncode)
        try:
            result = json.loads(stdout)
        except json.JSONDecodeError:
            _audit(
                "invalid_output", len(code_bytes), len(input_bytes), len(stdout), proc.returncode
            )
            return _error("invalid_output", "Analysis must print exactly one JSON value")

        _audit("ok", len(code_bytes), len(input_bytes), len(stdout), proc.returncode)
        return {"status": "ok", "result": result}


def create_run_analysis_tool(executor: CloudRunSandboxExecutor) -> Any:
    async def run_analysis(code: str, input_json: str = "{}") -> dict[str, Any]:
        """Run bounded Python analysis in an isolated, no-network sandbox.

        Use only when computation materially helps. Do not use for ordinary
        conversation, simple arithmetic, or a single Workspace operation.
        The program reads `/mnt/input/input.json` and must print exactly one
        JSON value to stdout. It cannot access the web or Workspace directly.

        Args:
            code: Python source. Keep it deterministic and data-only.
            input_json: Bounded JSON object/array prepared from already fetched,
                user-approved inputs. Never include OAuth tokens or secrets.
        """

        return await executor.execute(code=code, input_json=input_json)

    run_analysis.__name__ = RUN_ANALYSIS_TOOL_NAME
    return FunctionTool(run_analysis)


def create_run_analysis_tool_from_env() -> Any | None:
    if os.environ.get("SANDBOX_CODE_EXECUTION_ENABLED", "").lower() != "true":
        return None
    executor = CloudRunSandboxExecutor(
        launcher=os.environ.get("SANDBOX_LAUNCHER", DEFAULT_SANDBOX_LAUNCHER),
        timeout_s=float(os.environ.get("SANDBOX_TIMEOUT_S", "20")),
    )
    if not executor.available:
        print(json.dumps({"msg": "sandbox.disabled", "reason": "launcher_unavailable"}))
        return None
    return create_run_analysis_tool(executor)


async def _read_bounded(stream: asyncio.StreamReader, limit: int) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while chunk := await stream.read(8192):
        size += len(chunk)
        if size > limit:
            raise _OutputTooLarge
        chunks.append(chunk)
    return b"".join(chunks)


async def _drain(stream: asyncio.StreamReader) -> None:
    while await stream.read(8192):
        pass


async def _kill_process_group(proc: asyncio.subprocess.Process) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, signal.SIGKILL)
    await proc.wait()


def _error(code: str, message: str, *, exit_code: int | None = None) -> dict[str, Any]:
    return {
        "status": "error",
        "code": code,
        "message": message,
        **({"exitCode": exit_code} if exit_code is not None else {}),
    }


def _audit(
    outcome: str,
    code_bytes: int,
    input_bytes: int,
    output_bytes: int,
    exit_code: int | None,
) -> None:
    print(
        json.dumps(
            {
                "msg": "sandbox.execution",
                "outcome": outcome,
                "codeBytes": code_bytes,
                "inputBytes": input_bytes,
                "outputBytes": output_bytes,
                "exitCode": exit_code,
            }
        )
    )
