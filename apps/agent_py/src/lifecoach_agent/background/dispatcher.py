"""Background dispatcher — the `/background/scheduler/tick` body (ADR 0001 §2).

A pure coordinator: sweep due schedules, claim each transactionally, create the
run record, enqueue a Cloud Task, then advance ``nextRunAt`` and release the
lease. It never calls Gmail/Calendar/Tasks or the LLM.

Idempotency rests on three layers (ADR §2/§4): the Firestore lease (required),
the deterministic run id / Cloud Tasks task id (second layer), and the run
store's create-if-absent. So although the claim and the run-create are separate
store calls rather than one transaction, a crash between them is safe — the
lease expires, the next tick re-derives the *same* ids and no-ops the duplicate.

The query is bounded (``.limit(N).order_by(nextRunAt)``); a post-outage backlog
drains across ticks rather than risking the request deadline in one sweep.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from lifecoach_agent.background import ids
from lifecoach_agent.background.schedule_time import input_window, next_run_at
from lifecoach_agent.background.tasks_client import BackgroundTasksClient, TaskRequest
from lifecoach_agent.contracts.background import BackgroundRun
from lifecoach_agent.storage.background_runs import BackgroundRunStore
from lifecoach_agent.storage.background_schedules import BackgroundScheduleStore
from lifecoach_agent.storage.background_time import canonical_iso
from lifecoach_agent.storage.background_time import now_iso as _now_iso_default


class Dispatcher:
    def __init__(
        self,
        *,
        schedules: BackgroundScheduleStore,
        runs: BackgroundRunStore,
        tasks: BackgroundTasksClient,
        agent_base_url: str,
        invoker_sa_email: str,
        oidc_audience: str,
        limit: int = 20,
        lease_ttl_seconds: int = 120,
        now_iso: object = None,
    ) -> None:
        self._schedules = schedules
        self._runs = runs
        self._tasks = tasks
        self._agent_base_url = agent_base_url.rstrip("/")
        self._invoker_sa_email = invoker_sa_email
        self._oidc_audience = oidc_audience
        self._limit = limit
        self._lease_ttl_seconds = lease_ttl_seconds
        self._now_iso = now_iso or _now_iso_default

    def _lease_until(self, now: str) -> str:
        base = datetime.fromisoformat(now.replace("Z", "+00:00")).astimezone(UTC)
        return canonical_iso((base + timedelta(seconds=self._lease_ttl_seconds)).isoformat())

    async def tick(self) -> int:
        """Sweep + dispatch due schedules. Returns the number dispatched."""
        now = self._now_iso()  # type: ignore[operator]
        due = await self._schedules.query_due(limit=self._limit, now_iso=now)
        dispatched = 0
        for sched in due:
            scheduled_for = canonical_iso(sched.nextRunAt)
            run_id = ids.run_id(sched.id, sched.kind, scheduled_for)

            claimed = await self._schedules.claim_lease(
                schedule_id=sched.id,
                run_id=run_id,
                lease_expires_at=self._lease_until(now),
                now_iso=now,
            )
            if not claimed:
                continue

            window_start, window_end = input_window(
                sched.lookbackWindow, scheduled_for_iso=scheduled_for
            )
            run = BackgroundRun(
                id=run_id,
                uid=sched.uid,
                scheduleId=sched.id,
                kind=sched.kind,
                status="queued",
                idempotencyKey=ids.idempotency_key(sched.id, sched.kind, scheduled_for),
                scheduledFor=scheduled_for,
                inputWindowStart=window_start,
                inputWindowEnd=window_end,
                attempt=0,
                createdAt=canonical_iso(now),
            )
            await self._runs.create(run)

            await self._tasks.enqueue(
                TaskRequest(
                    task_id=ids.task_id(sched.id, sched.kind, sched.uid, scheduled_for),
                    url=f"{self._agent_base_url}/background/runs/{run_id}/execute",
                    payload={
                        "runId": run_id,
                        "scheduleId": sched.id,
                        "uid": sched.uid,
                        "kind": sched.kind,
                        "scheduledFor": scheduled_for,
                    },
                    oidc_service_account_email=self._invoker_sa_email,
                    oidc_audience=self._oidc_audience,
                )
            )

            # Advance scheduling only — the run *outcome* (lastStatus) is owned
            # by the executor, not the dispatcher.
            await self._schedules.release_lease_and_advance(
                schedule_id=sched.id,
                run_id=run_id,
                next_run_at=next_run_at(sched.cadence, sched.timezone, after_iso=scheduled_for),
            )
            dispatched += 1
        return dispatched
