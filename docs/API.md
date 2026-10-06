# API

Base path `/api`. JSON in, JSON out. Authenticated routes need `Authorization: Bearer <accessToken>`.

Errors always use:
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": [] } }
```
Codes: `VALIDATION_ERROR` 400, `UNAUTHENTICATED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404, `VERSION_CONFLICT` 409, `RATE_LIMITED` 429, `CODE_EXPIRED` 400, `CODE_LOCKED` 423, `INTERNAL` 500.

## Required endpoints (spec names)

| Method | Route | Auth | Body | Response |
| --- | --- | --- | --- | --- |
| POST | `/owner/CreateNewAccessCode` | public, rate-limited | `phoneNumber` | `{ success: true }` (+ `accessCode` in demo mode) |
| POST | `/owner/ValidateAccessCode` | public | `accessCode, phoneNumber` | `{ success: true, accessToken, user }` + refresh cookie |
| POST | `/GetEmployee` | owner, or self | `employeeId` | Employee object |
| POST | `/CreateEmployee` | owner | `name, email, phone, department, title` | `{ success: true, employeeId }` |
| POST | `/DeleteEmployee` | owner | `employeeId` | `{ success: true }` |
| POST | `/employee/LoginEmail` | public, rate-limited | `email` | `{ success: true }` (+ `accessCode` in demo mode) |
| POST | `/employee/ValidateAccessCode` | public | `accessCode, email` | `{ success: true, accessToken, user }` + refresh cookie |

`CreateNewAccessCode` and `LoginEmail` return the same response whether or not the phone/email exists.

## Auth

| Method | Route | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/employee/setup` | setup token | `{ token, username, password }` → activates account |
| POST | `/employee/login` | public, rate-limited | `{ username, password }` |
| POST | `/employee/resend-invite` | owner | `{ employeeId }` |
| POST | `/auth/refresh` | refresh cookie | new access token, rotates refresh token |
| POST | `/auth/logout` | any | revokes refresh token |

## Resources

| Method | Route | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/employees` | owner | `?q=&cursor=` |
| PATCH | `/employees/:id` | owner | contact info, department, title |
| GET | `/employees/:id/schedule` | owner, or self | |
| PUT | `/employees/:id/schedule` | owner | full weekly `shifts` array |
| GET | `/me` | any | |
| PATCH | `/me` | any | `name, phone, email` only |
| GET | `/tasks` | any | owner: all (`?assigneeId=`); employee: own |
| POST | `/tasks` | owner | `title, description, assigneeId, dueDate?` |
| PATCH | `/tasks/:id` | owner: any field; employee: `status, order` on own tasks | requires `version`; 409 returns latest task |
| DELETE | `/tasks/:id` | owner | |
| GET | `/conversations` | any | own conversations, newest first |
| GET | `/conversations/:id/messages` | participant | `?before=<cursor>&limit=30` |
| GET | `/activities` | owner | `?visibility=feed\|audit&cursor=` |
| GET | `/notifications` | any | `?cursor=` |
| PATCH | `/notifications/read` | any | `{ ids }` or `{ all: true }` |
| GET | `/cron/due-reminders` | `CRON_SECRET` header | Vercel Cron only |
| GET | `/health` | public | |

## Socket events

Handshake: `io(url, { transports: ['websocket'], auth: { token: accessToken } })`. Server joins `user:<id>`, plus `owner` for the owner.

| Event | Direction | Payload | Delivered to |
| --- | --- | --- | --- |
| `task:created` / `task:updated` / `task:deleted` | S → C | task | `owner`, `user:<assigneeId>` |
| `message:send` | C → S (ack) | `{ conversationId, clientMessageId, text }` | ack `{ ok, message }` |
| `message:new` | S → C | message | both participants |
| `typing:start` / `typing:stop` | C → S → C | `{ conversationId }` | other participant |
| `conversation:read` | C → S → C | `{ conversationId }` | other participant |
| `presence:heartbeat` | C → S | — | every 20s |
| `presence:update` | S → C | `{ userId, online, lastSeen }` | `owner`, chat partners |
| `activity:new` | S → C | activity | `owner` |
| `notification:new` | S → C | notification | `user:<id>` |
