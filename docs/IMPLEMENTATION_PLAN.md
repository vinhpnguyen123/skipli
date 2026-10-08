# Implementation plan

About 12 working days. Each phase ends with a working deploy and a git tag.

## Phase 0 — Setup and skeleton deploy (day 1) · `v0.1.0`
- [~] Monorepo `client/` + `server/`, oxlint, Prettier, TypeScript — *repo is local; not pushed to GitHub yet*
- [x] Two Firebase projects (`skipli-dev`, `skipli-prod`), Firestore (us-east4), service accounts; deny-all Security Rules
- [x] Accounts: Twilio (verify your number), Resend, Upstash Redis
- [x] `.env.example` with every variable from `ARCHITECTURE.md`
- [x] Express `/api/health`, central error handler, helmet, CORS
- [x] Socket.IO server; client with `transports: ['websocket']`; ping/pong works
- [x] Seed script: owner + demo employees — *re-run with `SEED_OWNER_PHONE` set to the Twilio-verified number*
- [ ] Deploy to Vercel; confirm WebSocket works on the real domain
- [ ] If WebSocket is unstable: move server to Render/Railway now

## Phase 1 — Owner auth and security core (days 2–3) · `v0.2.0`
- [ ] Middleware: `validate` (strict Zod), `requireAuth`, `requireRole`, ownership helper
- [ ] Redis rate limiter (per IP + per phone/email)
- [ ] Activity/audit service stub
- [ ] `CreateNewAccessCode`: `randomInt`, HMAC, 5-min expiry, SMS, identical response for unknown numbers
- [ ] `ValidateAccessCode`: expiry, attempts, `timingSafeEqual`, lock at 5, reset code to `""`
- [ ] Demo mode for demo accounts
- [ ] Access token (15 min) + refresh token (7 days, httpOnly cookie) with rotation and reuse detection
- [ ] Client: login page, resend countdown, refresh interceptor, socket reconnect with new token, phone in `localStorage`
- [ ] Tests: expiry, lockout, rate limit, refresh reuse

## Phase 2 — Employee management and onboarding (days 4–5) · `v0.3.0`
- [ ] `CreateEmployee` (name, email, phone, department, title), status `invited`
- [ ] Setup token (32 bytes, SHA-256, 48h), invite email, resend invite
- [ ] `GetEmployee`, list, edit, `DeleteEmployee` (revokes refresh tokens)
- [ ] Owner dashboard: table, search, status badges, add/edit forms
- [ ] `/setup` page: validate token, username + bcrypt password, mark used, activate, redirect
- [ ] Password login with lockout; `LoginEmail` + `ValidateAccessCode` (email)
- [ ] Profile page (no role/department changes)
- [ ] Audit: employee created/deleted, account setup, failed logins

## Phase 3 — Tasks, realtime kanban, due dates, notifications (days 6–7) · `v0.4.0`
- [ ] `mutate()` service: validate → authorize → transaction (data + activity) → emit
- [ ] Task CRUD; employees change only `status`/`order` of own tasks
- [ ] Optimistic locking with `version`, 409 with latest task
- [ ] Notifications on assign; email when offline (`waitUntil`)
- [ ] Vercel Cron due reminders with `CRON_SECRET`, `reminderSentAt`
- [ ] Kanban (dnd-kit) + Done button, optimistic update + rollback
- [ ] Overdue / due-soon badges, sort by due date
- [ ] Notification bell with unread count
- [ ] Refetch on reconnect
- [ ] Two-browser test (owner + employee), record clip for README

## Phase 4 — Realtime chat (days 8–9) · `v0.5.0`
- [ ] Socket.IO Redis adapter
- [ ] `message:send` with `clientMessageId` dedup, unread increment, ack
- [ ] History with cursor pagination; catch-up on reconnect
- [ ] Presence (connection count, heartbeat, TTL, `lastSeen`)
- [ ] Typing indicator (debounced, auto-stop 3s, not stored)
- [ ] Read receipts via `lastReadAt` (focused window only)
- [ ] Unread badges per conversation + total
- [ ] UI: conversation list + chat pane, pending/failed message states

## Phase 5 — Weekly schedule and activity feed (day 10) · `v0.6.0`
- [ ] `PUT /employees/:id/schedule` with overlap/order validation, overnight split
- [ ] Weekly grid (click to add/edit; drag only if time allows), timezone label
- [ ] Owner sees all (color per employee, filter); employee read-only
- [ ] Activity snapshots finalized; live feed widget on owner dashboard
- [ ] Audit log page with cursor pagination

## Phase 6 — Testing, CI, README, submission (days 11–12) · `v1.0.0`
- [ ] Tests (against `skipli-dev`) for all security cases + version conflict + message dedup
- [ ] GitHub Actions: lint, typecheck, test
- [ ] Loading/empty/error states, mobile layout, compare against Skipli's Figma
- [ ] README: live link, demo accounts, Loom video, architecture diagram, structure, run locally, env table, API summary, design decisions, security, screenshots
- [ ] Secret scan (gitleaks), full run-through in an incognito window
- [ ] Email repo link to both Skipli addresses

## Risks

| Risk | Fallback |
| --- | --- |
| Vercel WebSocket (beta) unstable | Server on Render/Railway |
| Reviewers can't receive SMS | Demo mode + demo accounts in README |
| Emails land in spam | Verified domain on Resend; resend-invite button |
| Running behind | Cut schedule drag-and-drop and typing indicator first; keep kanban + notifications |
