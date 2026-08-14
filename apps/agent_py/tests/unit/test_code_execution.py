from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest

from lifecoach_agent.code_execution import (
    MAX_CODE_BYTES,
    MAX_OUTPUT_BYTES,
    CloudRunSandboxExecutor,
    create_run_analysis_tool,
)


class _Stream:
    def __init__(self, value: bytes) -> None:
        self._value = value

    async def read(self, _size: int) -> bytes:
        value, self._value = self._value, b""
        return value


class _Process:
    returncode = 0
    pid = 123

    def __init__(self, stdout: bytes = b'{"total": 42}') -> None:
        self.stdout = _Stream(stdout)
        self.stderr = _Stream(b"")

    def kill(self) -> None:
        self.returncode = -9

    async def wait(self) -> int:
        return self.returncode


@pytest.mark.asyncio
async def test_executor_uses_no_egress_read_only_mount_and_structured_output() -> None:
    executor = CloudRunSandboxExecutor(launcher="/usr/bin/true")
    fake = AsyncMock(return_value=_Process())

    with patch("asyncio.create_subprocess_exec", fake):
        result = await executor.execute(
            code="import json; print(json.dumps({'total': 42}))",
            input_json='{"values":[20,22]}',
        )

    assert result == {"status": "ok", "result": {"total": 42}}
    argv = fake.await_args.args
    assert argv[:3] == ("/usr/bin/true", "do", "--write")
    assert "--allow-egress" not in argv
    assert "--env" not in argv
    mount = argv[argv.index("--mount") + 1]
    assert "destination=/mnt/input" in mount
    assert mount.endswith(",readonly")
    assert argv[-2:] == ("/usr/local/bin/python3", "/mnt/input/main.py")


@pytest.mark.asyncio
async def test_executor_stops_reading_and_kills_oversized_output() -> None:
    executor = CloudRunSandboxExecutor(launcher="/usr/bin/true")
    process = _Process(stdout=b"x" * (MAX_OUTPUT_BYTES + 1))

    with (
        patch("asyncio.create_subprocess_exec", AsyncMock(return_value=process)),
        patch("os.killpg") as killpg,
    ):
        result = await executor.execute(code="print('x')", input_json="{}")

    assert result["code"] == "output_too_large"
    killpg.assert_called_once()


@pytest.mark.asyncio
async def test_executor_rejects_invalid_or_oversized_inputs_before_launch() -> None:
    executor = CloudRunSandboxExecutor(launcher="/usr/bin/true")
    assert (await executor.execute(code="pass", input_json="secret"))["code"] == "invalid_input"
    assert (await executor.execute(code="x" * (MAX_CODE_BYTES + 1), input_json="{}"))[
        "code"
    ] == "code_too_large"


def test_run_analysis_tool_has_bounded_public_contract() -> None:
    tool = create_run_analysis_tool(CloudRunSandboxExecutor(launcher="/usr/bin/true"))
    assert tool.name == "run_analysis"
    declaration: dict[str, Any] = json.loads(tool._get_declaration().model_dump_json())
    assert set(declaration["parameters"]["properties"]) == {"code", "input_json"}
