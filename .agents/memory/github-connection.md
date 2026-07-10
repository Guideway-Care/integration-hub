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

## Token PRESENT ≠ token VALID (both creds can be dead at once)
- A push can fail with `remote: Invalid username or token. Password authentication is not supported for Git operations.` even though `GITHUB_PAT` is set (correct 40-char length) AND `listConnections('github')` returns a `gho_…` token under `settings.oauth.credentials.access_token`. That GitHub message = the token is **expired/revoked**, not malformed.
- **Why:** the env PAT and the OpenInt connector token expire independently and can both be stale simultaneously; the connector often shows `status:'disconnected'` while still returning a (dead) token, so a non-null token is NOT proof it works.
- **How to apply:** don't loop retrying either credential. Recovery is user-side and required: (a) reconnect GitHub in Replit (Git pane → Settings → Connections → disconnect + reconnect, let the OAuth popup fully complete), or (b) provide a fresh `GITHUB_PAT` (scopes `repo`,`workflow`). Then re-run the explicit-URL push above.
- **Diagnose the token, don't read the git error.** The git push message is opaque. Probe the token against GitHub's API instead: `curl -H "Authorization: Bearer $GITHUB_PAT" https://api.github.com/repos/Guideway-Care/integration-hub` and read the status: `401 Bad credentials` = the token *value* is dead/wrong (e.g. secret still holds the OLD token even after the user "created a new one" — updating a GitHub PAT does NOT update the Replit secret); `403` + `x-github-sso` header = SAML SSO authorization needed; `403` without it = missing scopes. Also grep `x-oauth-scopes` (need `repo, workflow`) and `permissions.push:true`. Run this in **bash**, not the code_execution sandbox — secrets are NOT injected into that JS env (`$GITHUB_PAT` reads empty there).

## workflow scope caveat
- The Replit OAuth authorize screen does not clearly grant the `workflow` scope. Pushes touching `.github/workflows/*` via the Git pane may be silently dropped — use the PAT for those (PAT has `workflow`). Normal code pushes are fine.

## Stale `.git/*.lock` after a blocked op
- The main-agent sandbox blocks ALL writes under `.git/` (including `rm` of lockfiles and `git update-ref`), classifying them as "destructive git operations". A blocked `git update-ref` can leave a stale `refs/remotes/github/main.lock` that then jams fetch/pull ("index lockfile still exists").
- Recovery: the user clears them from the **Shell** tab (`rm -f .git/refs/remotes/github/*.lock`), or a reconnect of the Git connection clears them as a side effect.
