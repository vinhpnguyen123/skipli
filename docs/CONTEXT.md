# Context

## The challenge

Skipli asks for a full-stack app with a React front-end, an Express back-end, and Firebase as the database, with SMS (Twilio or similar) and email integration. Submission is a public GitHub repo with a README (structure + how to run) and screenshots, emailed to:

- engineering@skiplinow.com
- hongnguyen.skipli.engineering@gmail.com

## Roles

**Owner (manager)**
- Logs in with phone number + 6-digit SMS code.
- Adds, edits, deletes employees; sets weekly work schedules.
- Adding an employee sends them an email with a link to set up their account.
- Chats with each employee in real time (Socket.IO).

**Employee**
- Receives a setup email, opens a secure link, chooses username + password.
- Logs in (username + password, or 6-digit email code).
- Edits own profile (name, phone, email).
- Views assigned tasks and marks them Done.

## Required endpoints (names fixed by the spec)

| Role | Endpoint | Params | Returns |
| --- | --- | --- | --- |
| Owner | CreateNewAccessCode | phoneNumber | 6-digit code (saved to the phone's record, sent by SMS) |
| Owner | ValidateAccessCode | accessCode, phoneNumber | `{ success: true }`; code reset to empty string |
| Owner | GetEmployee | employeeId | Employee object |
| Owner | CreateEmployee | name, email, department | `{ success: true, employeeId }` |
| Owner | DeleteEmployee | employeeId | `{ success: true }` |
| Employee | LoginEmail | email | 6-digit code (saved, sent by email) |
| Employee | ValidateAccessCode | accessCode, email | `{ success: true }`; code reset to empty string |

## Spec gaps and decisions

| Gap in the spec | Decision |
| --- | --- |
| Employee form lists name/phone/email/role; `CreateEmployee` lists name/email/department | Accept all five fields |
| Two endpoints named `ValidateAccessCode` | Separate routes: `/api/owner/...` and `/api/employee/...` |
| Employee login described as password and as email OTP | Support both |
| Owner phone "already stored in the database" | Seed script creates the owner |
| "Return a 6-digit code" from the code-sending endpoints | Code is never returned in production; returned only in `DEMO_MODE` for demo accounts |
| Tasks named in the title but barely specified | Full task CRUD + realtime kanban |
| Twilio trial only texts verified numbers | `DEMO_MODE` so reviewers can log in |

## Scope beyond the spec

Security: hashed OTPs with 5-minute expiry and 5-attempt lockout; rate limits per IP and per phone/email; single-use, short-lived, hashed setup tokens; strict Zod validation + role and ownership checks; short-lived access tokens + revocable rotating refresh tokens.

Features: realtime kanban with optimistic locking; chat presence, typing indicators, read receipts, unread counts; weekly schedule grid; activity feed + audit log; due dates, notifications, and due-date reminders.

Quality: tests on the emulator, CI, architecture docs, demo video.
