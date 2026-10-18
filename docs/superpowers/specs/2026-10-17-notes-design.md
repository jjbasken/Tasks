# Notes (StandardNotes replacement) — Design Spec

**Date:** 2026-10-17
**Status:** Implemented

## Goal

Replace StandardNotes with notes inside this app, keeping its encryption model: the server stores only ciphertext.

Decisions: a Markdown editor with live preview; revision history, StandardNotes import, file attachments and protected notes; notes live in the existing lists (personal or shared) and are organized with encrypted nested tags.

Out of scope: Super/rich-text and other editors, Listed publishing, custom smart views, note-to-note links, encrypted StandardNotes backups, StandardNotes file attachments.

## Data model

| Table | Holds |
|---|---|
| `notes` | `id, list_id, encrypted_payload, created_at, updated_at` |
| `note_tags` | Tags, same shape as notes |
| `note_revisions` | Prior note ciphertext, snapshotted by the server on update |
| `sync_tombstones` | `id, list_id, kind (note/tag), deleted_at`, for incremental sync |
| `files` | Attachment rows: `list_id, note_id, uploader_id, size, encrypted_metadata, uploaded`; bytes on disk under `files/` next to the database |

Payloads (`packages/shared/src/types.ts`): `NotePayload` (title, text, tag ids, attachment ids, pinned, archived, trashed_at, locked, protected, client created/edited timestamps), `TagPayload` (title, parent id), `FileMetadata` (name, MIME type, size, per-file key). All are encrypted with the list key.

## API

- `notes.sync({listId, since})` returns notes and tags with `updated_at >= since`, plus tombstones, and a cursor. The bound is inclusive so a write in the cursor's millisecond is never missed; clients merge by id.
- `notes.create` / `tags.create` are idempotent on a client UUID; an id that exists in another list is a CONFLICT.
- `notes.update` snapshots the replaced ciphertext into `note_revisions` at most once per 10 minutes and keeps the newest 100.
- `notes.delete` is permanent (trash is an encrypted flag) and removes revisions and attachments.
- `notes.importBatch` takes up to 100 notes/tags per call and bypasses the browser outbox.
- `notes.move` takes a payload and attachment metadata re-encrypted for the target list; revisions are dropped.
- `files.create` reserves a row and quota for a note in the same list; `PUT /api/files/:id` accepts exactly the reserved size once; `GET /api/files/:id` streams ciphertext to list members.
- `auth.kdfSalt` lets a device-approved session re-verify the passphrase.
- `lists.delete` cascades notes, tags, revisions, tombstones and files.

## Client

- Writes go through the existing encrypted outbox with new `note.*` and `tag.*` operations. A new autosave for a note folds into its latest pending write, except the head entry, which may be in flight.
- Each list's notes are cached in TanStack Query and synced incrementally from the cursor; pending outbox writes are overlaid before display.
- Markdown is rendered with marked and sanitized with DOMPurify (fails closed if the DOM is unusable). `attachment:<id>` references resolve to decrypted `blob:` URLs, so CSP `img-src` allows `blob:`.
- Protected notes require re-deriving the stretch key from the passphrase and comparing it in constant time with the unlocked one; the unlock lasts 5 minutes in memory. This is an access gate, not extra encryption.
- Attachments use a random per-file key (XSalsa20-Poly1305 over the whole file, nonce prepended).
- StandardNotes import reads decrypted backups (`.txt`/`.json` or the export `.zip`), converts Super (Lexical JSON) to Markdown, and derives list-scoped UUIDv5-style ids from the source ids so re-imports are no-ops. Export writes a zip of Markdown files with front matter, attachments, and a lossless JSON backup the importer reads back.
