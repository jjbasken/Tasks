# Tasks

A self-hosted, end-to-end encrypted task manager for families. Tasks are organized into personal and shared lists. All task content is encrypted client-side with libsodium — the server stores only ciphertext and never sees your data.

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
- [Security](#security)

---

## Features

- **Now / Later / Done buckets** — manual prioritization, no due-date pressure
- **Recurring tasks** — full iCal RRULE support (daily, weekly, monthly, custom patterns)
- **Shared lists** — invite family members; list key is re-encrypted per member
- **E2E encryption** — passphrase never leaves your device; server stores only ciphertext
- **Multi-device** — new devices approved by an existing trusted device via an encrypted handshake
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
DB_DATA_PATH=./data                   # path on the host for the SQLite volume
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

The SQLite database is stored at `DB_DATA_PATH` (default: `./data/db.sqlite`).
Port 3001 is deliberately not published on the host; this keeps proxy-derived
source addresses trustworthy for authentication rate limits.

### Cloudflare Tunnel

The compose file includes a `cloudflared` service. Set `CLOUDFLARE_TUNNEL_TOKEN` in your `.env` and configure the tunnel in the Cloudflare dashboard to route your domain to `http://frontend:8080`.

If you prefer a traditional reverse proxy (Caddy, nginx), remove the `cloudflared` service and proxy to `http://localhost:3000`.

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

This runs tests for both the `shared` package and the `backend`. The frontend has no tests.

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

**Tasks:** all task content is encrypted with a per-list symmetric key (XChaCha20-Poly1305) before leaving the browser. The server stores `encrypted_payload` blobs only.

**Shared lists:** list names and task payloads are encrypted with the per-list key. Only a list's owner can invite, and the list key is encrypted to each invited member's public key. Before any key material is sealed, the recipient's public key is checked against a trust-on-first-use pin and its fingerprint is shown for out-of-band comparison, so a substituted key is a visible error rather than a silent one. Owners automatically migrate legacy list names from stretch-key encryption after their first upgraded login.

Removing a member deletes their membership row, which revokes their access to the list. It does **not** yet rotate the list key, so a removed member retains the key for ciphertext they already hold.

**New devices:** a new device sends a key exchange request; a trusted device encrypts a versioned bundle containing the user's private key and stretch key to the new device's public key. The server relays the ciphertext only and cannot open it.

---

## Security

- The passphrase never leaves the client device — only an Argon2id-derived verifier is sent
- The server holds no plaintext task content, list names, or private key material
- `JWT_SECRET` is validated at startup — the server refuses to start on an unset, short, or placeholder secret
- `CORS_ORIGIN` must be set explicitly — the server refuses to start without it
- Only a list's owner can invite others to it, and a user can hold at most one membership per list (enforced by a database constraint)
- Failed logins are rate limited to 10 per account and 30 per source address per 15 minutes, checked before any password hashing
- Unknown usernames get a constant-work login path and a decoy KDF salt, so neither timing nor responses reveal which accounts exist
- Every API input is length-bounded, so no caller can exhaust storage or CPU with an oversized payload
- The frontend is served under a strict Content-Security-Policy — no inline scripts, and `script-src` allows only same-origin scripts plus `'wasm-unsafe-eval'` for libsodium's WebAssembly (JavaScript `eval()` stays blocked) — alongside HSTS, `X-Frame-Options`, `nosniff` and `Referrer-Policy`
- Pending device approval requests are capped at 5 active requests per user, expire after 10 minutes, are source-rate-limited, and require a 6-digit code derived from the new device's own public key
- Session tokens expire after 12 hours, live only in browser memory, and are individually revocable: logout revokes exactly that session, and an admin can invalidate every session for a user at once
