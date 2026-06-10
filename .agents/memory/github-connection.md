---
name: GitHub connection on Replit (this repo)
description: How the Replit↔GitHub connection works for Guideway-Care/integration-hub, why it breaks, and how to recover.
---

# GitHub connection for Guideway-Care/integration-hub

## Two separate "GitHub connections" — don't confuse them
- **Workspace Git connection** (Git pane → Settings → Connections → "GitHub ● Active"): this is what powers `git push`/`pull` from the workspace Git UI.
- **Integrations connector** (`listConnections('github')`, id `conn_github_…`): a separate OpenInt record used for programmatic GitHub API access.

**Why:** these track independently and can disagree — the workspace Git connection can be **Active** while `listConnections('github')` still reports `disconnected`.
**How to apply:** do NOT use `listConnections('github')` status to judge whether push/pull works. Trust the Git-pane "Active" badge (or a real `git ls-remote`/push) for that.

## Recovering a broken workspace Git connection (org-owned repo)
Symptom: Git pane shows "Unknown Git Error", pushes 401, connection "disconnected".
1. The org side (`Guideway-Care` → Settings → Third-party access → OAuth app policy) was already **Approved** for Replit — org approval was NOT the blocker. Don't click "Remove restrictions" / "Deny access".
2. Real fix was Replit-side: Git pane → gear/**Settings** → **Connections** → disconnect GitHub, then reconnect and let the OAuth popup fully complete (popup/cookie blockers silently kill the callback, which is why earlier reconnects "didn't take").
3. "Account → Connections" is also reachable from the profile-picture menu; it is NOT in the workspace tools/files search palette.

## PAT fallback (when the connection is down)
- A user-supplied `GITHUB_PAT` (scopes `repo`,`workflow`) pushes reliably from the CLI. Push to the **explicit URL**, not the named `github` remote (its URL has a stale embedded `x-access-token` that 401s):
  `git -c credential.helper='!f(){ echo username=x-access-token; printf "password=%s\n" "$GITHUB_PAT"; }; f' push https://github.com/Guideway-Care/integration-hub.git HEAD:main`
- Always mask tokens in output: pipe through `sed -E 's#x-access-token:[^@]*@#x-access-token:***@#g'`.

## workflow scope caveat
- The Replit OAuth authorize screen does not clearly grant the `workflow` scope. Pushes touching `.github/workflows/*` via the Git pane may be silently dropped — use the PAT for those (PAT has `workflow`). Normal code pushes are fine.

## Stale `.git/*.lock` after a blocked op
- The main-agent sandbox blocks ALL writes under `.git/` (including `rm` of lockfiles and `git update-ref`), classifying them as "destructive git operations". A blocked `git update-ref` can leave a stale `refs/remotes/github/main.lock` that then jams fetch/pull ("index lockfile still exists").
- Recovery: the user clears them from the **Shell** tab (`rm -f .git/refs/remotes/github/*.lock`), or a reconnect of the Git connection clears them as a side effect.
