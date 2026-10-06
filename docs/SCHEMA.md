# Schema

All Firestore access goes through `firebase-admin` on the server. Security Rules deny all client reads and writes. Timestamps are Firestore `Timestamp` in UTC unless noted.

## Firestore collections

### `users/{userId}`
| Field | Type | Notes |
| --- | --- | --- |
| role | `'owner' \| 'employee'` | |
| name | string | |
| email | string | lowercased, unique |
| phone | string | E.164, unique |
| department | string | |
| title | string | role/position shown in UI |
| username | string \| null | unique, set during onboarding |
| passwordHash | string \| null | bcrypt, cost 12 |
| status | `'invited' \| 'active' \| 'disabled'` | |
| failedLogins, lockedUntil | number, Timestamp \| null | password lockout |
| createdAt, updatedAt | Timestamp | |

### `accessCodes/{channel}:{target}`
One live code per target. `channel` is `phone` or `email`.
| Field | Type | Notes |
| --- | --- | --- |
| codeHmac | string | HMAC-SHA256 with `OTP_HMAC_SECRET`; `""` after successful validation |
| expiresAt | Timestamp | created + 5 min |
| attempts | number | lock at 5 |
| createdAt | Timestamp | |

### `setupTokens/{tokenHash}`
| Field | Type | Notes |
| --- | --- | --- |
| userId | string | |
| expiresAt | Timestamp | created + 48h |
| usedAt | Timestamp \| null | single use |

### `refreshTokens/{tokenHash}`
| Field | Type | Notes |
| --- | --- | --- |
| userId | string | |
| familyId | string | revoke the whole chain on reuse |
| expiresAt | Timestamp | created + 7 days |
| revokedAt | Timestamp \| null | |
| replacedBy | string \| null | hash of the next token |

### `tasks/{taskId}`
| Field | Type | Notes |
| --- | --- | --- |
| title, description | string | |
| assigneeId | string | |
| status | `'todo' \| 'in_progress' \| 'done'` | |
| order | number | position within a column |
| dueDate | Timestamp \| null | UTC |
| version | number | optimistic locking, +1 per update |
| reminderSentAt | Timestamp \| null | |
| createdBy | string | |
| createdAt, updatedAt | Timestamp | |

### `schedules/{employeeId}`
One document per employee holding the weekly pattern.
| Field | Type | Notes |
| --- | --- | --- |
| shifts | `{ dayOfWeek: 0-6, start: 'HH:mm', end: 'HH:mm' }[]` | local time in `BUSINESS_TZ`; no overlaps; overnight shifts split |
| updatedAt | Timestamp | |

### `conversations/{userIdA_userIdB}`
ID is the two user IDs sorted and joined, so each pair has one conversation.
| Field | Type | Notes |
| --- | --- | --- |
| participantIds | string[2] | |
| lastMessage | string | preview |
| lastMessageAt | Timestamp | |
| lastReadAt | map userId → Timestamp | read receipts |
| unread | map userId → number | incremented on send, reset on read |

### `conversations/{id}/messages/{clientMessageId}`
| Field | Type | Notes |
| --- | --- | --- |
| senderId | string | |
| text | string | max 2000 chars |
| createdAt | Timestamp | server time |

### `activities/{activityId}` (append-only)
| Field | Type | Notes |
| --- | --- | --- |
| actorId, actorName | string | name snapshot |
| action | string | e.g. `task.completed`, `employee.deleted`, `auth.otp_failed` |
| targetType, targetId, targetName | string | name snapshot |
| visibility | `'feed' \| 'audit'` | |
| metadata | map | |
| createdAt | Timestamp | |

### `notifications/{notificationId}`
| Field | Type | Notes |
| --- | --- | --- |
| userId | string | |
| type | string | `task.assigned`, `task.due_soon`, `task.overdue` |
| payload | map | |
| read | boolean | |
| createdAt | Timestamp | |

## Composite indexes

| Collection | Fields |
| --- | --- |
| tasks | assigneeId ASC, status ASC, order ASC |
| tasks | status ASC, dueDate ASC (cron) |
| conversations | participantIds ARRAY_CONTAINS, lastMessageAt DESC |
| activities | visibility ASC, createdAt DESC |
| notifications | userId ASC, createdAt DESC |

## Redis keys

| Key | Type | TTL | Purpose |
| --- | --- | --- | --- |
| `rl:ip:<route>:<ip>` | counter | window | rate limit per IP |
| `rl:target:<route>:<phoneOrEmail>` | counter | window | rate limit per target |
| `presence:<userId>` | string | 45s | online heartbeat |
| `presence:conns:<userId>` | counter | none | open sockets per user |
| `socket.io#*` | adapter | — | managed by `@socket.io/redis-adapter` |
