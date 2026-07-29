---
name: Prod dashboard "I don't see the change" debugging ladder
description: How to diagnose operators reporting missing UI on the Cloud Run prod dashboard
---

The rule: when an operator reports a missing UI element on prod, verify in this order — (1) CD deployed the commit and traffic is 100% latest revision; (2) the sidebar build stamp (commit sha + build time, injected via vite define + GITHUB_SHA build-arg) matches; (3) client-side state: stale `localStorage` values can shadow server-side fallbacks and hide panels with zero errors.

**Why:** A missing "Batch progress" panel went through three false explanations (not deployed / browser cache / proxy). Real cause was a stale batch id in the operator's localStorage whose progress query succeeded with total 0 — silently hiding the panel. Silent `.catch(() => empty)` query fallbacks made every failure invisible; headless screenshots (no localStorage) looked fine.

**How to apply:** Never gate UI purely on "query returned non-empty" with a silent catch — surface the error state. Index.html is served with `no-store` (enterprise proxies ignored `no-cache`). Also: piping `pnpm typecheck` into `tail` masks its exit code in `&&` chains — use PIPESTATUS.
