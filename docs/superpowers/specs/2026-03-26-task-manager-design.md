# E2E Encrypted Task Manager — Design Spec

**Date:** 2026-03-26
**Status:** Approved

---

## Overview

A self-hosted, end-to-end encrypted task management web app. Multiple family members each have their own account. Tasks are organized into personal lists or shared lists. All task content is encrypted client-side using libsodium before reaching the server — the server stores only ciphertext.

---

## Goals

- One-time and recurring tasks with full iCal RRULE recurrence support
- Manual "Now" and "Later" buckets to distinguish urgent vs. future tasks
- Per-user accounts with optional shared lists between users
- E2E encryption: server cannot read any task content or list names
- Self-hosted via Docker Compose on a VPS or home server
- Responsive web app that works on desktop and mobile browsers

---

## Non-Goals

- Native mobile apps (iOS/Android) — responsive web only
- Offline-first / local sync (may be added later)
- Calendar integration
- File attachments

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| State / data fetching | TanStack Query v5 |
| API client | tRPC client |
| Routing | React Router v7 |
| Encryption (client) | libsodium-wrappers |
| Recurrence | rrule.js |
| Backend runtime | Bun |
| Backend framework | Hono |
| API layer | tRPC via @hono/trpc-server |
| ORM | Drizzle ORM |
| Database | SQLite (bun:sqlite) |
| Auth tokens | JWT via jose |
| Password hashing | argon2 |
| Deployment | Docker Compose |

---

## Repository Structure

```
tasks/                          # monorepo root
  apps/
    frontend/                   # React + Vite app
    backend/                    # Bun + Hono server
  packages/
    shared/                     # tRPC router types, crypto utilities, task types
  docker-compose.yml
```

---

## Encryption Model

### Primitives
- **Key derivation:** Argon2id (passphrase → stretch key)
- **Asymmetric encryption:** curve25519 keypair (libsodium Box / Sealed Box)
- **Symmetric encryption:** XChaCha20-Poly1305 (libsodium SecretBox)

### Per-User Keys
Each user has:
- A **curve25519 keypair** — public key stored plaintext on server; private key encrypted with the user's stretch key
- A **personal list key** — random 32-byte symmetric key, encrypted with the user's stretch key

### Registration Flow
1. User enters passphrase
2. Client generates a random `kdf_salt`
3. Client derives stretch key via Argon2id(passphrase, kdf_salt) — never sent to server
4. Client generates curve25519 keypair
5. Client generates random personal list key
6. Client encrypts private key and personal list key with stretch key
7. Sends to server: `username`, `email`, `kdf_salt`, `public_key`, `encrypted_private_key`, `encrypted_personal_list_key`

### Login Flow
1. User enters username + passphrase
2. Client fetches `kdf_salt` and `encrypted_private_key` from server (pre-auth endpoint)
3. Client derives stretch key via Argon2id using the retrieved salt (never sent to server)
4. Client decrypts private key locally — all list keys are now accessible
5. Client sends `passwordHash` to server for authentication
6. Server issues a long-lived JWT (30 days) for subsequent API calls — the user unlocks once per session; there is no mid-session passphrase re-prompt

### New Device (Device Trust)
1. New device generates its own device keypair; sends device approval request
2. Existing trusted device sees pending request in device management UI
3. Trusted device encrypts user's private key to new device's public key (libsodium Sealed Box)
4. New device decrypts — now has full key material
5. Server acts as relay only — never sees the private key in transit

### Shared List Encryption
1. List owner generates a random list key
2. Owner encrypts list key to each member's public key (curve25519 Box)
3. Each `list_memberships` row stores one `encrypted_list_key` per user
4. To invite a new member: encrypt list key to their public key, insert row
5. To revoke: delete their membership row and rotate the list key (re-encrypt to remaining members)

### Task Encryption
- All task content is encrypted with the relevant list key before being sent to the server
- Server stores only: `task_id`, `list_id`, `encrypted_payload`, `created_at`, `updated_at`

---

## Data Model

### Server-side tables (Drizzle ORM / SQLite)

```
users
  id               uuid PK
  username         text UNIQUE NOT NULL
  email            text UNIQUE NOT NULL
  password_hash    text NOT NULL          -- argon2 hash for login auth
  public_key       text NOT NULL          -- base64 curve25519 public key
  kdf_salt         text NOT NULL          -- base64 random salt for Argon2id key derivation
  encrypted_private_key   text NOT NULL  -- base64 ciphertext
  encrypted_personal_list_key  text NOT NULL
  created_at       integer NOT NULL

lists
  id               uuid PK
  owner_id         uuid FK → users
  encrypted_name   text NOT NULL
  is_shared        boolean NOT NULL DEFAULT false
  created_at       integer NOT NULL

list_memberships
  id               uuid PK
  list_id          uuid FK → lists
  user_id          uuid FK → users
  encrypted_list_key  text NOT NULL      -- list key encrypted to this user's public key
  invited_by       uuid FK → users
  created_at       integer NOT NULL

tasks
  id               uuid PK
  list_id          uuid FK → lists
  encrypted_payload  text NOT NULL       -- JSON ciphertext
  created_at       integer NOT NULL
  updated_at       integer NOT NULL

devices
  id               uuid PK
  user_id          uuid FK → users
  public_key       text NOT NULL         -- device's curve25519 public key
  name             text NOT NULL         -- e.g. "iPhone", "MacBook"
  approved_by      uuid FK → devices NULL  -- null = first device
  created_at       integer NOT NULL
  approved_at      integer NULL
```

### Client-side encrypted task payload (JSON, encrypted before send)

```typescript
type TaskPayload = {
  title:        string
  notes:        string | null
  bucket:       'now' | 'later'
  status:       'active' | 'done'
  rrule:        string | null       // iCal RRULE string, e.g. "FREQ=WEEKLY;BYDAY=MO,WE"
  due_date:     string | null       // ISO date string, one-time tasks only
  completed_at: string | null       // ISO date string
}
```

---

## Recurrence Behaviour

- Recurrence rules stored as iCal RRULE strings (parsed/generated by rrule.js)
- Supported patterns: daily, weekly, monthly, yearly, every N days/weeks, specific weekdays, "last weekday of month", "first Monday of month", etc.
- When a recurring task is marked done, the client generates the next occurrence as a new task and saves it immediately
- Completed occurrences remain in the Done bucket

---

## API — tRPC Routers

### `auth`
- `getLoginChallenge(username)` → `{ kdfSalt, encryptedPrivateKey, encryptedPersonalListKey }` (pre-auth, unauthenticated)
- `register(username, email, kdfSalt, passwordHash, publicKey, encryptedPrivateKey, encryptedPersonalListKey)` → `{ userId }`
- `login(username, passwordHash)` → `{ token }`
- `logout()` → void

### `tasks`
- `list(listId)` → `{ id, encryptedPayload, createdAt, updatedAt }[]`
- `create(listId, encryptedPayload)` → `{ id }`
- `update(taskId, encryptedPayload)` → void
- `delete(taskId)` → void

### `lists`
- `list()` → `{ id, encryptedName, isShared, encryptedListKey }[]`
- `create(encryptedName, encryptedListKey)` → `{ id }`
- `invite(listId, inviteeUsername, encryptedListKey)` → void
- `removeMember(listId, userId)` → void

### `devices`
- `listPending()` → `{ id, name, publicKey, createdAt }[]`
- `approve(deviceId, encryptedPrivateKey)` → void
- `revoke(deviceId)` → void
- `list()` → `{ id, name, approvedAt }[]`

### `users`
- `search(username)` → `{ userId, username, publicKey } | null`

---

## Frontend Routes

| Route | Description |
|---|---|
| `/login` | Sign in |
| `/register` | Create account |
| `/tasks` | Main task view (Now / Later / Done tabs) |
| `/lists` | All lists (personal + shared) |
| `/lists/new` | Create a new shared list |
| `/lists/:id` | Switch active list (redirects to /tasks) |
| `/devices` | Manage trusted devices, approve pending |
| `/settings` | Account settings, change passphrase |

---

## UI Layout

- **Sidebar:** list switcher (Personal + shared lists), nav links to Devices and Settings
- **Main area:** tabs for Now / Later / Done; task rows with title, recurrence indicator, completion toggle
- **Task detail:** slide-in panel for editing title, notes, bucket, recurrence, due date
- **Recurrence picker:** UI built on rrule.js for selecting simple and complex recurrence patterns

---

## Self-Hosting

`docker-compose.yml` defines two services:

```yaml
services:
  frontend:
    image: tasks-frontend
    ports: ["3000:80"]
    environment:
      VITE_API_URL: /api

  backend:
    image: tasks-backend
    ports: ["3001:3001"]
    environment:
      DATABASE_URL: /data/db.sqlite
      JWT_SECRET: <user-provided>
      CORS_ORIGIN: <user-provided>
    volumes:
      - sqlite-data:/data

volumes:
  sqlite-data:
```

- Users are expected to put a reverse proxy (Caddy or nginx) in front for HTTPS
- SQLite means no separate database container — just a volume-mounted file
- Single `docker compose up` to run the full stack

---

## Security Considerations

- Passphrase never leaves the client device
- Server stores no plaintext task content, list names, or key material in plaintext
- JWT tokens are 30-day session tokens; user explicitly logs out to end a session
- Device revocation immediately invalidates that device's session
- List key rotation required when revoking a shared list member
- `users.search` returns only public key + username — no other user data exposed

---

## Future Considerations (out of scope)

- Offline-first support with local IndexedDB cache and sync queue
- Push notifications for shared list updates
- Native mobile apps
- Task comments / activity feed
- Admin panel for self-hosting (user management, storage stats)
