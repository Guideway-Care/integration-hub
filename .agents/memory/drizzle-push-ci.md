---
name: drizzle-kit push in CI (non-interactive migrations)
description: Why drizzle-kit push --force can silently apply nothing in CI, and the plain-push + guarded-SQL + verification contract that fixes it.
---

- `drizzle-kit push --force` only auto-approves **data-loss** statements. It does NOT auto-answer the interactive "add unique constraint → do you want to truncate?" arrow-key SELECT prompt.
- On a non-TTY CI runner that prompt gets EOF and `push` **exits 0 having applied NOTHING** — a silent no-op that looks green. One un-applied constraint blocks the WHOLE push, so every other pending additive change (new tables/columns) also never lands.

**Why:** A `UNIQUE(endpoint_id, parameter_name)` constraint pending in the schema since the first commit meant every prod CD migration was a no-op; a later `scheduled_job_run` table therefore never got created, so daily/manual job-run recording + history silently failed in prod even though CD was green and the app "completed" runs (in-memory only).

**How to apply — the CD contract (cd.yml `migrate-db` job + replit.md gotcha):**
1. Apply constraint-type / risky changes via **guarded idempotent psql** (additive, no truncation, `RAISE EXCEPTION` on real duplicates) BEFORE the push, so push has no data-loss statement to prompt about.
2. Run **plain** `push` (NOT `--force`) with stdin closed (`</dev/null`): additive changes apply non-interactively; any remaining data-loss statement makes push EOF-abort applying nothing.
3. **Verify convergence** so a silent no-op or accidental destructive change turns the build RED: require `Changes applied` in the push output, assert no prompt text ("do you want to truncate", "you're about to", "about to add") appeared, and hard-check the expected objects exist (`to_regclass(...)`, `pg_constraint`).

**Diagnosing "CD green but prod schema not updated":** pull the migrate job log via the GitHub Actions API and look for a "Do you want to truncate …?" SELECT immediately followed by the next step — that's the tell that push aborted.

**Gotcha:** `drizzle-kit push` prints `[✓] Changes applied` even when zero statements run (already-converged DB); it does NOT print "No changes detected" — do not gate convergence checks on that string. `push-force` stays in `lib/db/package.json` for deliberate local use only.
