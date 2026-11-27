import type { CheckpointEvent, CheckpointItem, CheckpointSnapshot, Evidence } from './types.js'
import { array, assertCheckpoint, assertEvidence, assertItem, assertItemShape, fail, keys, nonempty, nonnegative, record, strings } from './validation.js'
import { owns, freezeData, contains, cloneData, equalData, append, indexWhere, removeAt, someValue, mapValues, mapOf, mapGet, mapSet, setOf, setAdd, setHas } from './intrinsics.js'

const EVENT_TYPES = freezeData(['set_goal', 'add_constraint', 'retract_constraint', 'record_fact', 'complete_task', 'open_task', 'reject_path', 'record_resource'])

function assertEvent(value: unknown): asserts value is CheckpointEvent {
  const event = record(value, 'event', 'INVALID_EVENT')
  keys(event, ['id', 'type', 'item', 'evidence'], 'event', 'INVALID_EVENT')
  nonempty(event.id, 'event.id', 'INVALID_EVENT')
  if (typeof event.type !== 'string' || !contains(EVENT_TYPES, event.type)) fail('INVALID_EVENT', 'event.type is not part of v1')
  array(event.evidence, 'event.evidence', 'INVALID_EVENT')
  for (let index = 0; index < event.evidence.length; index++) assertEvidence(event.evidence[index], 'event.evidence entry', 'INVALID_EVENT')
  if (event.type === 'retract_constraint') {
    const target = record(event.item, 'event.item', 'INVALID_EVENT')
    keys(target, ['id', 'text', 'evidenceIds', 'status'], 'event.item', 'INVALID_EVENT', ['id'])
    nonempty(target.id, 'event.item.id', 'INVALID_EVENT')
    if (owns(target, 'text')) nonempty(target.text, 'event.item.text', 'INVALID_EVENT')
    if (owns(target, 'evidenceIds')) strings(target.evidenceIds, 'event.item.evidenceIds', 'INVALID_EVENT')
    if (owns(target, 'status') && target.status !== 'confirmed' && target.status !== 'candidate') fail('INVALID_EVENT', 'event.item.status is invalid')
  } else if (!(event.type === 'set_goal' && event.item === null)) assertItemShape(event.item, 'event.item', 'INVALID_EVENT')
}

function addOnly(collection: CheckpointItem[], item: CheckpointItem): void {
  const copy = cloneData(item)
  const index = indexWhere(collection, entry => entry.id === item.id)
  if (index >= 0) {
    if (!equalData(collection[index], copy)) fail('ITEM_CONFLICT', 'An existing item id cannot silently overwrite its text or provenance')
    return
  }
  append(collection, copy)
}

/** Full data validation precedes cloning; CAS and event receipt semantics stay unchanged. */
export function applyCheckpointEvents(snapshot: unknown, events: unknown, options: { expectedRevision: number }): CheckpointSnapshot {
  assertCheckpoint(snapshot)
  const settings = record(options, 'options', 'INVALID_INPUT')
  keys(settings, ['expectedRevision'], 'options', 'INVALID_INPUT')
  nonnegative(settings.expectedRevision, 'options.expectedRevision', 'INVALID_INPUT')
  if (settings.expectedRevision !== snapshot.revision) fail('REVISION_CONFLICT', 'expectedRevision does not match the current checkpoint revision')
  array(events, 'events', 'INVALID_EVENT')
  const seen = setOf(snapshot.appliedEventIds)
  const fresh: CheckpointEvent[] = []
  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    assertEvent(event)
    if (!setHas(seen, event.id)) { setAdd(seen, event.id); append(fresh, event) }
  }
  if (!fresh.length) {
    const copy = cloneData(snapshot)
    assertCheckpoint(copy)
    return copy
  }
  if (snapshot.revision === Number.MAX_SAFE_INTEGER) fail('REVISION_CONFLICT', 'checkpoint revision cannot advance safely')
  const next = cloneData(snapshot)
  const evidenceById = mapOf<string, Evidence>(mapValues(next.evidenceRefs, source => [source.id, source] as const))
  // Whole-batch sources resolve forward references; normalized copies retain every own field.
  for (let eventIndex = 0; eventIndex < fresh.length; eventIndex++) {
    const event = fresh[eventIndex]
    for (let sourceIndex = 0; sourceIndex < event.evidence.length; sourceIndex++) {
      const source = cloneData(event.evidence[sourceIndex])
      const existing = mapGet(evidenceById, source.id)
      if (existing) {
        if (!equalData(existing, source)) fail('EVIDENCE_CONFLICT', 'An evidence id cannot change its reference, digest, revocation or scope')
      } else { mapSet(evidenceById, source.id, source); append(next.evidenceRefs, source) }
    }
  }
  for (let eventIndex = 0; eventIndex < fresh.length; eventIndex++) {
    const event = fresh[eventIndex]
    if (event.type === 'retract_constraint') {
      if (!someValue(event.evidence, source => source.kind === 'user' && !source.revoked)) fail('UNTRUSTED_EVIDENCE', 'Constraint retraction requires explicit non-revoked user evidence on this event')
      const index = indexWhere(next.constraints, item => item.id === event.item.id)
      if (index < 0) fail('ITEM_NOT_FOUND', 'Constraint retraction requires an existing constraint id')
      removeAt(next.constraints, index)
      continue
    }
    if (event.type === 'set_goal' && event.item === null) { next.goal = null; continue }
    assertItem(event.item, evidenceById, 'event.item', 'INVALID_EVENT')
    const item = event.item
    switch (event.type) {
      case 'set_goal': next.goal = cloneData(item); break
      case 'add_constraint': addOnly(next.constraints, item); break
      case 'record_fact': addOnly(next.facts, item); break
      case 'open_task':
        if (someValue(next.completed, entry => entry.id === item.id)) fail('ITEM_CONFLICT', 'A completed item cannot also be pending')
        addOnly(next.pending, item)
        break
      case 'complete_task': {
        const index = indexWhere(next.pending, entry => entry.id === item.id)
        if (index < 0) fail('ITEM_NOT_FOUND', 'Completion requires an existing pending item id')
        removeAt(next.pending, index)
        addOnly(next.completed, item)
        break
      }
      case 'reject_path': addOnly(next.rejected, item); break
      case 'record_resource': addOnly(next.resources, item); break
    }
  }
  for (let index = 0; index < fresh.length; index++) append(next.appliedEventIds, fresh[index].id)
  next.revision += 1
  assertCheckpoint(next)
  return next
}
