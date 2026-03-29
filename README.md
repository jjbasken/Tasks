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

### Running with Docker Compose

```sh
docker compose up -d
```

This starts three services:

| Service | Port | Description |
|---|---|---|
| `frontend` | 3000 | React app served by nginx |
| `backend` | 3001 | Bun + Hono API server |
| `cloudflared` | — | Cloudflare Tunnel (exposes frontend publicly) |

The SQLite database is stored at `DB_DATA_PATH` (default: `./data/db.sqlite`).

### Cloudflare Tunnel

The compose file includes a `cloudflared` service. Set `CLOUDFLARE_TUNNEL_TOKEN` in your `.env` and configure the tunnel in the Cloudflare dashboard to route your domain to `http://frontend:80`.

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

Each user has a **curve25519 keypair**. The private key is encrypted with a key derived from their passphrase (Argon2id) and never stored in plaintext anywhere — not on the server, not in the browser.

**Registration:** the client derives a stretch key from the passphrase, generates a keypair and a personal list key, encrypts both with the stretch key, and sends only ciphertext to the server.

**Login:** the client fetches the KDF salt, re-derives the stretch key locally, and decrypts the private key. The passphrase is never transmitted.

**Tasks:** all task content is encrypted with a per-list symmetric key (XChaCha20-Poly1305) before leaving the browser. The server stores `encrypted_payload` blobs only.

**Shared lists:** the list key is encrypted to each member's public key. Revoking a member deletes their row and rotates the list key for remaining members.

**New devices:** a new device sends a key exchange request; a trusted device encrypts the user's private key to the new device's public key. The server relays the ciphertext only.

---

## Security

- The passphrase never leaves the client device
- The server holds no plaintext task content, list names, or private key material
- JWT session tokens expire after 24 hours; device tokens are revocable individually
- `CORS_ORIGIN` must be set explicitly — wildcard origins are rejected
- `JWT_SECRET` is required at startup — the server refuses to start without it
- Pending device approval requests are capped at 5 per user to prevent flooding
