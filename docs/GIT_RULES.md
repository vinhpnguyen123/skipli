# Git rules

## Branches

- `main` is always deployable; Vercel deploys it to production.
- Work on short-lived branches off `main`: `feat/owner-otp`, `fix/refresh-rotation`, `docs/readme-screenshots`, `chore/ci`.
- Prefixes: `feat/`, `fix/`, `refactor/`, `test/`, `docs/`, `chore/`.
- Every branch gets a Vercel preview deploy; check it before merging.

## Commits

[Conventional Commits](https://www.conventionalcommits.org): `type(scope): summary`

```
feat(auth): hash OTPs with HMAC and lock after 5 attempts
fix(tasks): return 409 with latest task on version conflict
test(auth): cover refresh token reuse detection
docs(readme): add architecture diagram and demo accounts
```

- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `perf`, `style`.
- Scopes: `auth`, `employees`, `tasks`, `chat`, `schedule`, `activity`, `notifications`, `socket`, `client`, `server`, `infra`.
- Imperative mood, under 72 characters, no trailing period.
- Commit small and often. A steady, readable history also shows reviewers the work is your own.

## Pull requests

- One feature or fix per PR, merged with squash.
- Description: what changed, why, how it was tested, screenshots for UI.
- CI (lint, typecheck, tests) must pass before merge.
- Self-review the diff before merging: no debug logs, no commented-out code, no secrets.

## Secrets

- Never commit `.env`, `serviceAccount*.json`, or real phone numbers/emails.
- `.gitignore` covers `.env*` (except `.env.example`), `*.json` keys, `node_modules`, build output.
- If a secret is committed: rotate it immediately, then remove it from history. Rotating comes first because the repo is public.

## Releases

Tag the end of each phase: `v0.1.0` (setup), `v0.2.0` (owner auth), … `v1.0.0` (submission).
