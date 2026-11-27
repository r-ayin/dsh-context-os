/** Task state only. No persistence, inference, session wiring or ambient authorization. */
export type EvidenceKind = 'user' | 'tool' | 'file' | 'transcript' | 'model'
export type ItemStatus = 'confirmed' | 'candidate'

export interface EvidenceScope {
  agent_scope: string | null
  workspace_scope: string | null
  explicitGlobal: boolean
}

export interface Evidence {
  id: string
  kind: EvidenceKind
  reference: string
  sha256?: string
  observedAt: string
  revoked: boolean
  scope: EvidenceScope
}

export interface CheckpointItem {
  id: string
  text: string
  evidenceIds: string[]
  status: ItemStatus
}

export interface CheckpointSnapshot {
  schemaVersion: 1
  taskId: string
  sessionIds: string[]
  revision: number
  goal: CheckpointItem | null
  constraints: CheckpointItem[]
  facts: CheckpointItem[]
  completed: CheckpointItem[]
  pending: CheckpointItem[]
  rejected: CheckpointItem[]
  resources: CheckpointItem[]
  evidenceRefs: Evidence[]
  appliedEventIds: string[]
}

export type ItemEventType = 'add_constraint' | 'record_fact' | 'complete_task' | 'open_task' | 'reject_path' | 'record_resource'
export type CheckpointEvent =
  | { id: string; type: 'set_goal'; item: CheckpointItem | null; evidence: Evidence[] }
  | { id: string; type: 'retract_constraint'; item: { id: string }; evidence: Evidence[] }
  | { id: string; type: ItemEventType; item: CheckpointItem; evidence: Evidence[] }

export interface CheckpointAccessContext {
  authorizedScopes: Array<{ agent_scope: string; workspace_scope: string }>
  allowExplicitGlobal: boolean
}

export type CheckpointErrorCode =
  | 'INVALID_INPUT' | 'INVALID_CHECKPOINT' | 'INVALID_EVENT'
  | 'MISSING_EVIDENCE' | 'UNTRUSTED_EVIDENCE' | 'REVISION_CONFLICT'
  | 'EVIDENCE_CONFLICT' | 'ITEM_CONFLICT' | 'ITEM_NOT_FOUND'
  | 'PERMISSION_DENIED' | 'BUDGET_EXCEEDED'

export class CheckpointError extends Error {
  readonly code: CheckpointErrorCode
  constructor(code: CheckpointErrorCode, message: string) {
    super(message)
    this.name = 'CheckpointError'
    this.code = code
  }
}

export type CheckpointValidation =
  | { ok: true }
  | { ok: false; code: CheckpointErrorCode; message: string }

export interface RenderCheckpointResult {
  ok: boolean
  text: string
  requiredChars: number
  overflow: boolean
  omittedCandidateIds: string[]
  code?: CheckpointErrorCode
  message?: string
}
