# Conventions

## General

- TypeScript strict mode everywhere; no `any` without a comment explaining why.
- ESLint + Prettier; CI fails on lint or type errors.
- Shared types live in the server and are mirrored on the client (or a small `shared/` package if duplication grows).

## Naming

| Thing | Style | Example |
| --- | --- | --- |
| Files (TS) | kebab-case | `task-service.ts` |
| React components | PascalCase file + export | `TaskCard.tsx` |
| Hooks | `use` prefix | `useTasks.ts` |
| Variables, functions | camelCase | `assigneeId` |
| Constants, env | UPPER_SNAKE | `OTP_TTL_MS` |
| Firestore fields | camelCase | `lastReadAt` |
| Socket events | `noun:verb` | `task:updated` |
| Activity actions | `noun.verb_past` | `task.completed` |

## Server

```
routes/       HTTP wiring only: route → middleware → controller
middleware/   validate, requireAuth, requireRole, rateLimit, errorHandler
services/     business logic; the only layer that touches Firestore
socket/       connection auth, room joins, event handlers (call services)
lib/          clients: firebase, twilio, email, redis
schemas/      Zod schemas, one file per resource
```

- Controllers stay thin: parse validated input, call a service, shape the response.
- Every mutation uses `mutate()` so the activity log and broadcasts can't be forgotten.
- Throw `AppError(code, message, status)`; `errorHandler` turns it into the standard error body. Never leak stack traces or Firestore errors to clients.
- Zod schemas use `.strict()`. Infer types from schemas instead of writing them twice.
- Compare secrets with `crypto.timingSafeEqual`. Generate codes with `crypto.randomInt`, tokens with `crypto.randomBytes`.
- Use Firestore transactions for read-then-write logic (OTP attempts, task version checks, token rotation).
- Log with a structured logger; never log codes, tokens, passwords, or full phone numbers.

## Client

```
pages/        route-level screens
features/     auth, employees, tasks, chat, schedule, activity, notifications
components/   shared UI
lib/          api client (refresh interceptor), socket client, formatters
```

- Server data through TanStack Query; socket events update the query cache instead of separate state.
- Optimistic updates roll back on error and show a toast.
- Access token in memory only; phone number in `localStorage` (spec requirement); nothing sensitive in `localStorage`.
- Every screen handles loading, empty, and error states.
- Dates: store UTC, display in the viewer's locale; schedules display in `BUSINESS_TZ`.

## Testing

- Server: Jest + Supertest against the Firebase emulators; Twilio and email mocked.
- Must-have cases: OTP expiry, 5-attempt lockout, rate limits, setup token reuse/expiry, refresh token reuse, role checks, ownership (IDOR), task version conflict, duplicate `clientMessageId`.
- Test names describe behavior: `rejects a reused setup token`.
