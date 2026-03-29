# Admin User Management — Design Spec

**Date:** 2026-03-28

## Overview

Extend the admin "Create user" page (`/register`) to support:
1. Marking a new user as admin at creation time
2. Viewing all existing user accounts and their roles on the same page
3. Toggling a user's admin role after creation

## Backend Changes

### `auth.register` mutation (existing)
Add an optional `isAdmin` field to the input schema:
```ts
isAdmin: z.boolean().optional()  // defaults to false
```
Pass it through to the `db.insert(users)` call.

### `users.list` query (new)
Add a new `adminProcedure` query to `usersRouter`:
- Returns all users: `id`, `username`, `email`, `isAdmin`, `createdAt`
- Admin-only (uses `adminProcedure`)
- No pagination needed — user count is expected to be small

### `users.setAdmin` mutation (new)
Add a new `adminProcedure` mutation to `usersRouter`:
- Input: `userId: z.string()`, `isAdmin: z.boolean()`
- Updates the `isAdmin` field for the given user in the database
- Admin-only
- Guard: prevent an admin from removing their own admin role (compare `userId` to `ctx.userId`)

## Frontend Changes

### `useAuth` hook
Update `register(username, email, passphrase, isAdmin?)` to accept an optional `isAdmin` boolean and pass it to the mutation.

### `RegisterPage` (existing, at `/register`)

**Form section (top):**
- Existing fields: username, email, passphrase, confirm passphrase
- New field: "Admin user" checkbox (unchecked by default)
- On successful submit: clear the form, show success message, and invalidate the user list query so it refreshes

**User list section (below form):**
- Heading: "All Users"
- Simple table with columns: Username, Email, Role, Joined
- Role column shows a toggle button: "Admin" or "User" (clicking toggles via `users.setAdmin`)
- The current admin's own row has the toggle disabled to prevent self-demotion
- Optimistic UI: toggle updates immediately, reverts on error
- Joined shows a human-readable date
- List is fetched via `users.list` query and invalidated after each toggle

## Out of Scope
- Deleting users
- Pagination
