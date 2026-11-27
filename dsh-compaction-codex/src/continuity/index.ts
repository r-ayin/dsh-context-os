import type { CheckpointSnapshot } from './types.js'
import { keys, nonempty, record } from './validation.js'

export { applyCheckpointEvents } from './events.js'
export { renderCheckpoint } from './render.js'
export { validateCheckpoint } from './validation.js'
export { CheckpointError } from './types.js'
export type { CheckpointAccessContext, CheckpointErrorCode, CheckpointEvent, CheckpointItem, CheckpointSnapshot, CheckpointValidation, Evidence, EvidenceKind, EvidenceScope, ItemEventType, ItemStatus, RenderCheckpointResult } from './types.js'

/** A detached revision-zero state; session ids carry no authorization identity. */
export function createCheckpoint(input: { taskId: string; sessionId: string }): CheckpointSnapshot {
  const request = record(input, 'input', 'INVALID_INPUT')
  keys(request, ['taskId', 'sessionId'], 'input', 'INVALID_INPUT')
  nonempty(request.taskId, 'input.taskId', 'INVALID_INPUT')
  nonempty(request.sessionId, 'input.sessionId', 'INVALID_INPUT')
  return {
    schemaVersion: 1,
    taskId: request.taskId,
    sessionIds: [request.sessionId],
    revision: 0,
    goal: null,
    constraints: [],
    facts: [],
    completed: [],
    pending: [],
    rejected: [],
    resources: [],
    evidenceRefs: [],
    appliedEventIds: [],
  }
}
