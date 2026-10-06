# CLAUDE.md

Project context for AI assistants (Claude Code, Claude chat) working in this repo. Read this first, then the docs it links to.

## Project

Skipli coding challenge: a **real-time employee task management tool**. An owner logs in with an SMS one-time code, manages employees, assigns tasks, sets weekly schedules, and chats with employees in real time. Employees onboard through an email link, log in with a password or an email one-time code, update their profile, and move their tasks to Done.

## Stack

| Layer | Choice |
| --- | --- |
| Frontend | Vite + React + TypeScript, React Router, TanStack Query, dnd-kit, Tailwind |
| Backend | Express + TypeScript, Socket.IO, Zod, bcrypt, jsonwebtoken, helmet |
| Database | Firestore via `firebase-admin` (no client SDK access) |
| Realtime scaling | Upstash Redis (Socket.IO adapter, presence, rate limits) |
| SMS / email | Twilio / Resend |
| Deploy | Vercel (static + Functions + Cron), one domain |
| Tests / CI | Jest, Supertest, Firebase Emulator Suite, GitHub Actions |

## Commands

```bash
npm install                 # root, installs client + server workspaces
npm run dev                 # client (5173) + server (3000) concurrently
npm run emulators           # Firebase Emulator Suite
npm run seed                # seed owner + demo employees
npm run lint && npm run typecheck
npm test                    # server tests against emulators
```

## Non-negotiable rules

1. The server is the source of truth. The client never reads or writes Firestore directly.
2. Every mutation goes through `services/mutate`: validate → authorize → Firestore transaction (data + activity) → emit to rooms.
3. Every request body is validated with a strict Zod schema. Unknown fields are rejected.
4. Every route declares its auth: public, `requireAuth`, `requireRole(...)`, plus ownership checks where a resource belongs to a user.
5. Never store secrets in plain text: OTPs as HMAC, setup and refresh tokens as SHA-256, passwords with bcrypt.
6. Never commit `.env`, service-account JSON, or real phone numbers/emails.
7. Required endpoint names from the spec stay exactly as written (see `docs/API.md`).

## Docs

## Docs

Always loaded:
- Challenge requirements and decisions: @docs/CONTEXT.md
- Architecture and flows: @docs/ARCHITECTURE.md
- Code conventions: @docs/CONVENTIONS.md
- Git workflow: @docs/GIT_RULES.md
- Current progress: @docs/IMPLEMENTATION_PLAN.md

Read on demand when the task needs them:
- Firestore schema and Redis keys: `docs/SCHEMA.md`
- REST endpoints and socket events: `docs/API.md`
