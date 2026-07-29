---
name: Dev api-server acts on prod GCP resources
description: The workspace dev api-server shares the prod GCP project; its background loops trigger real Cloud Run jobs
---

The rule: the dev api-server running in this workspace uses the same GCP project (`guidewaycare-476802`) as production. Its background loops — notably the self-heal sweep (10-min interval, fires immediately at startup) — trigger and act on the REAL `incontact-call-processor` / loader jobs and BigQuery queue.

**Why:** After deploying a "watchdog respects Pause" fix to prod, the processor kept restarting every 10 minutes anyway. The culprit was the local dev workflow still running pre-fix code — its sweep ticks were visible as executions created at a constant xx:X7:13 phase. Prod deploys don't touch the dev process.

**How to apply:** After changing any api-server background/watchdog/scheduler logic, restart the local `artifacts/api-server: API Server` workflow too — deploying to prod is not enough. When hunting "who triggered this Cloud Run execution", check the tick phase alignment and remember the dev instance is a suspect. Same applies to anything else in dev that holds credentials to shared infra.
