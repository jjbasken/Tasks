# Tasks

A self-hosted, end-to-end encrypted task manager and notes app for families. Tasks and notes are organized into personal and shared lists. All content is encrypted client-side with libsodium — the server stores only ciphertext and never sees your data.

## Table of Contents

- [Features](#features)
- [Self-Hosting](#self-hosting)
  - [Prerequisites](#prerequisites)
  - [Environment Variables](#environment-variables)
  - [Running with Docker Compose](#running-with-docker-compose)
  - [Cloudflare Tunnel](#cloudflare-tunnel)
  - [First-Time Setup](#first-time-setup)
- [Development](#development)
  - [Prerequisites](#prerequisites-1)
  - [Running Locally](#running-locally)
  - [Running Tests](#running-tests)
- [Architecture](#architecture)
  - [Tech Stack](#tech-stack)
  - [Monorepo Structure](#monorepo-structure)
  - [Encryption Model](#encryption-model)
- [Notes](#notes)
- [Security](#security)

---

## Features

- **Now / Later / Done buckets** — manual prioritization, no due-date pressure
- **Recurring tasks** — full iCal RRULE support (daily, weekly, monthly, custom patterns)
- **Shared lists** — invite family members; list key is re-encrypted per member
- **E2E encryption** — passphrase never leaves your device; server stores only ciphertext
- **Multi-device** — new devices approved by an existing trusted device via an encrypted handshake
- **Notes** — a StandardNotes replacement: Markdown notes with live preview and clickable checklists, nested tags, pin / archive / trash, search and sorting, revision history, read-only and passphrase-protected notes, encrypted file attachments, offline editing, and import from a StandardNotes backup (see [Notes](#notes))
- **Self-hosted** — single `docker compose up`, SQLite, no external dependencies

---

## Self-Hosting

### Prerequisites

- Docker and Docker Compose
- A domain name pointed at your server (or a Cloudflare Tunnel — see below)

### Environment Variables

Create a `.env` file in the repo root:

```env
# Required
JWT_SECRET=<long-random-string>
CLOUDFLARE_TUNNEL_TOKEN=<your-tunnel-token>

# Optional
CORS_ORIGIN=https://your-domain.com   # defaults to http://localhost:3000
DB_DATA_PATH=./data                   # host path for the SQLite volume (absolute if a manager like Dockhand deploys)
MAX_FILE_BYTES=52428800               # largest note attachment, default 50 MiB
FILES_QUOTA_BYTES=2147483648          # attachment storage per user, default 2 GiB
```

Generate a strong `JWT_SECRET`:

```sh
openssl rand -base64 48
```

The server validates `JWT_SECRET` at boot and refuses to start if it is unset,
shorter than 32 characters, or a known placeholder such as `change-me`. Anyone
who knows the signing key can mint a token for any account, so `.env.example`
deliberately ships this value empty rather than with a working default.

### Running with Docker Compose

```sh
docker compose up -d
```

The backend runs as UID 1000. When using the default bind-mounted data
directory, create it with matching ownership before first start:

```sh
mkdir -p "${DB_DATA_PATH:-./data}"
chown 1000:1000 "${DB_DATA_PATH:-./data}"
```

This starts three services:

| Service | Port | Description |
|---|---|---|
| `frontend` | 3000 | React app served by nginx |
| `backend` | internal only | Bun + Hono API server, reachable only through nginx |
| `cloudflared` | — | Cloudflare Tunnel (exposes frontend publicly) |

The SQLite database is stored at `DB_DATA_PATH` (default: `./data/db.sqlite`). Encrypted note attachments are stored next to it in `files/`, so back up the whole directory.

If a container-based manager (Dockhand, Portainer, etc.) deploys the stack, set
`DB_DATA_PATH` to an absolute host path such as `/home/you/tasks/data`. These
tools run Compose inside their own container, where the project folder is
mounted at a different path, so `./data` resolves to a different host directory.
Docker then creates it empty and root-owned, and the backend fails with
`SQLITE_CANTOPEN`.

Port 3001 is deliberately not published on the host; this keeps proxy-derived
source addresses trustworthy for authentication rate limits.

### Cloudflare Tunnel

The compose file includes a `cloudflared` service. Set `CLOUDFLARE_TUNNEL_TOKEN` in your `.env` and configure the tunnel in the Cloudflare dashboard to route your domain to `http://frontend:8080`.

cloudflared runs at a fixed address (`10.213.47.2`) on a dedicated `edge` network, and nginx trusts the `CF-Connecting-IP` header only from that address, so rate limits apply per real client rather than to the tunnel as a whole. If `10.213.47.0/29` collides with a network on your host, change it in both `docker-compose.yml` and `apps/frontend/nginx.conf`.

If you prefer a traditional reverse proxy (Caddy, nginx), remove the `cloudflared` service and proxy to `http://localhost:3000`. Point `set_real_ip_from`/`real_ip_header` in `apps/frontend/nginx.conf` at your proxy; otherwise every client shares your proxy's rate-limit bucket.

### First-Time Setup

On first run, the app starts in bootstrap mode. Navigate to your domain and you'll be prompted to create the first (admin) account. Subsequent registrations require an invite or admin approval.

---

## Development

### Prerequisites

- [Bun](https://bun.sh) v1.3+

### Running Locally

```sh
# Install dependencies
bun install

# Start the backend (http://localhost:3001)
bun run dev:backend

# Start the frontend (http://localhost:5173)
bun run dev:frontend
```

The frontend proxies `/api` to the backend via Vite's dev server config.

### Running Tests

```sh
bun test
```

This runs the tests for the `shared` package, the `backend` and the `frontend` (outbox, Markdown sanitizing, notes model and the StandardNotes importer).

---

## Architecture

### Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, TypeScript |
| State / data fetching | TanStack Query v5 |
| API client/server | tRPC v11 |
| Routing | React Router v7 |
| Encryption | libsodium-wrappers |
| Recurrence | rrule.js |
| Notes | marked (Markdown), DOMPurify (sanitizing), fflate (zip import/export) |
| Backend runtime | Bun |
| Backend framework | Hono |
| ORM | Drizzle ORM |
| Database | SQLite (bun:sqlite) |
| Auth tokens | JWT (jose) |
| Deployment | Docker Compose |

### Monorepo Structure

```
tasks/
  apps/
    frontend/        # React + Vite app
    backend/         # Bun + Hono API server
  packages/
    shared/          # tRPC router types, crypto utilities, shared types
  docker-compose.yml
```

### Encryption Model

Each user has a **curve25519 keypair**. The private key is encrypted with a key derived from their passphrase (Argon2id) before it is stored by the server. After login, plaintext key material exists only in browser memory and is removed on reload, tab close, or logout.

**Registration:** the client derives a stretch key from the passphrase, generates a keypair and a personal list key, encrypts both with the stretch key, and sends only ciphertext to the server.

**Login:** the client fetches the KDF salt, re-derives the stretch key locally, and decrypts the private key. The passphrase is never transmitted.

**Tasks:** all task content is encrypted with a per-list symmetric key (XSalsa20-Poly1305) before leaving the browser. The server stores `encrypted_payload` blobs only.

**Shared lists:** list names and task payloads are encrypted with the per-list key. Only a list's owner can invite, and the list key is encrypted to each invited member's public key. Before any key material is sealed, the recipient's public key is checked against a trust-on-first-use pin and its fingerprint is shown for out-of-band comparison, so a substituted key is a visible error rather than a silent one. Owners automatically migrate legacy list names from stretch-key encryption after their first upgraded login.

**Notes:** each note's title, Markdown body, tags and flags are one encrypted payload under the list key, like a task. Tags are encrypted the same way. The server keeps prior versions of a note for revision history by copying ciphertext it cannot read.

**Attachments:** every file is encrypted in the browser with its own random key. That key, the file name and its type are encrypted with the list key and stored as metadata; the file bytes are stored as ciphertext on disk. Moving a note to another list re-wraps the small metadata instead of re-encrypting the file.

Removing a member deletes their membership row, which revokes their access to the list. It does **not** yet rotate the list key, so a removed member retains the key for ciphertext they already hold.

**New devices:** a new device sends a key exchange request; a trusted device encrypts a versioned bundle containing the user's private key and stretch key to the new device's public key. The server relays the ciphertext only and cannot open it.

---

## Notes

Open **Notes** in the sidebar. Notes live in the same lists as tasks, so a note in a shared list is visible to that list's members. "All lists" shows everything at once.

- **Editing** — Markdown with Edit, Split and Preview layouts, a formatting toolbar, Ctrl+B / Ctrl+I, and checkboxes (`- [ ]`) you can tick in the preview. Notes save automatically. Alt+N creates a note.
- **Organizing** — nested tags (type `work/projects` in a note's tag field to create both levels), pin, archive and trash. Trashed notes stay until you delete them forever or empty the trash.
- **Revision history** — a version is kept each time a note changes, at most once every 10 minutes and up to 100 per note. Restore any of them from the note's menu.
- **Read-only and protected notes** — "Prevent editing" makes a note read-only. "Protect with passphrase" hides a note's content until you re-enter your passphrase, which then keeps protected notes open for 5 minutes. As in StandardNotes, protection is an access gate on this device, not an extra layer of encryption.
- **Attachments** — attach files from the toolbar; images can be shown inline. Uploading needs a connection. Each user can store up to `FILES_QUOTA_BYTES` of attachments.
- **Offline** — edits made offline are queued encrypted on the device and sync when you reconnect, the same way tasks do.
- **Moving notes** — move a note to another list from its menu. It is re-encrypted for that list, its tags are matched by name there, and its revision history stays behind and is removed.

### Moving from StandardNotes

1. In StandardNotes, open Preferences → Backups and download a **decrypted** backup.
2. Here, open Settings → Notes → Import from StandardNotes and choose the `.txt` file, or the `.zip` StandardNotes produced.
3. Pick the list to import into.

Notes, nested tags, and pinned, archived, trashed, read-only and protected states come across with their original dates. Super notes are converted to Markdown (headings, formatting, links, lists, checklists, quotes, code, tables). Importing the same backup into the same list again changes nothing, so an interrupted import can simply be rerun.

Not supported: encrypted StandardNotes backups, StandardNotes file attachments (its backups do not contain them; download them from StandardNotes and attach them here), the Super rich-text editor and other editors (spreadsheets, code), Listed publishing, custom smart views, and note-to-note links.

**Export** — Settings → Notes → Export all notes downloads a zip with one Markdown file per note (tags and dates in YAML front matter), your attachments, and `notes-backup.json`, which this app can import for a lossless restore. The export is decrypted; store it accordingly.

---

## Security

- The passphrase never leaves the client device — only an Argon2id-derived verifier is sent
- The server holds no plaintext task content, list names, or private key material
- `JWT_SECRET` is validated at startup — the server refuses to start on an unset, short, or placeholder secret
- `CORS_ORIGIN` must be set explicitly — the server refuses to start without it
- Only a list's owner can invite others to it, and a user can hold at most one membership per list (enforced by a database constraint)
- Failed logins are rate limited to 10 per account and 30 per source address per 15 minutes, checked before any password hashing
- Unknown usernames get a constant-work login path and a decoy KDF salt, so neither timing nor responses reveal which accounts exist
- Every API input is length-bounded, so no caller can exhaust storage or CPU with an oversized payload. Encrypted notes are capped at 2 MiB, attachments at `MAX_FILE_BYTES` per file and `FILES_QUOTA_BYTES` per user, and an upload must match the size reserved for it
- Rendered Markdown is sanitized with DOMPurify: raw HTML in a note cannot run script, and links open in a new tab without access to this page
- The frontend is served under a strict Content-Security-Policy — no inline scripts, and `script-src` allows only same-origin scripts plus `'wasm-unsafe-eval'` for libsodium's WebAssembly (JavaScript `eval()` stays blocked) — alongside HSTS, `X-Frame-Options`, `nosniff` and `Referrer-Policy`
- Pending device approval requests are capped at 5 active requests per user, expire after 10 minutes, are source-rate-limited, and require a 6-digit code derived from the new device's own public key
- Session tokens expire after 12 hours, live only in browser memory, and are individually revocable: logout revokes exactly that session, and an admin can invalidate every session for a user at once

### Offline changes

Task, note and tag changes are saved as encrypted operations in a browser-local queue scoped to the account. New tasks use stable client-generated IDs so edits and deletes remain valid during replay. Rapid autosaves of the same note are folded into one pending write. Operations are replayed in order; failed requests retain the pending work and display a retry message. Logging out keeps encrypted pending changes for the same account’s next unlock. Queues cannot sync while the vault is locked. Clearing browser storage deletes unsynced changes.

Recurring occurrences record which completed task spawned them. Undo only removes active occurrences with that exact parent; older occurrences without a parent reference are retained.
