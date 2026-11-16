import type { TaskPayload } from '@tasks/shared'

// Legacy occurrences have no parent identity. Keep them rather than guessing
// which unrelated task a matching recurrence rule belongs to.
export function spawnedOccurrences(tasks: (TaskPayload & { id: string })[], parentId: string): string[] {
  return tasks.filter(t => t.status === 'active' && t.spawned_by === parentId).map(t => t.id)
}
