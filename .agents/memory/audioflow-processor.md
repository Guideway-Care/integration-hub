---
name: audioflow-processor (separate system, same GCP project)
description: What the audioflow-processor Cloud Run job is, where it lives, and the July 2026 Gemini 404 diagnosis.
---

# audioflow-processor

A call transcription/AI-enrichment Cloud Run job in `guidewaycare-476802` that is NOT
part of this repo (image `…/audioflow/processor:latest`, own codebase, own SA
`guideway-conversation-intel-ma@…`). It transcribes InContact call recordings with
Deepgram and post-processes transcripts with Gemini on Vertex AI.

## July 2026 diagnosis: Gemini 404s are a retired model, not an access problem

Its logs show `[Gemini] Post-processing error … 404 … gemini-2.0-flash … NOT_FOUND`.
Verified with the job's own SA: `gemini-2.0-flash` is 404 (retired) in BOTH
`gwc-poc-487320` and `guidewaycare-476802`, while `gemini-2.5-flash` returns 200 in
both. So the fix is a model-name bump in the audioflow codebase + image rebuild — the
model is not configurable via env (only `VERTEX_AI_PROJECT` is).

Impact profile: Deepgram transcription and BigQuery inserts keep succeeding; only the
Gemini enrichment output is silently missing per call. Executions still show
"completed", so this fails quietly.

Also noteworthy: `VERTEX_AI_PROJECT=gwc-poc-487320` — Gemini usage bills to the old
POC project, not the main one. Worth switching to `guidewaycare-476802` when the model
is fixed.

**How to apply:** if asked about audioflow errors, remember this repo can only inspect
(via GCP APIs + the job's secret in Secret Manager), not fix — changes need the
audioflow codebase.
