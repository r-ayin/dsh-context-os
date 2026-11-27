import { CheckpointError } from './types.js'
import type { CheckpointErrorCode, CheckpointItem, CheckpointSnapshot, CheckpointValidation, Evidence } from './types.js'
import { arrayPrototype, objectPrototype, prototypeOf, ownKeys, descriptorOf, owns, isArray, isProxy, safeInteger, finite, numberOf, stringOf, parseDate, freezeData, hasText, matchData, contains, mapValues, someValue, mapOf, mapGet, mapSet, mapHas, setOf, setAdd, setHas } from './intrinsics.js'

export const ARRAY_CATEGORIES = freezeData(['constraints', 'facts', 'completed', 'pending', 'rejected', 'resources'] as const)
const EVIDENCE_KINDS = freezeData(['user', 'tool', 'file', 'transcript', 'model'])

export function fail(code: CheckpointErrorCode, message: string): never { throw new CheckpointError(code, message) }

/** Reflect only after excluding proxies; never evaluate an input accessor or inherited method. */
export function record(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || isProxy(value) || isArray(value)) fail(code, label + ' must be plain non-proxy data')
  const prototype = prototypeOf(value)
  if (prototype !== objectPrototype && prototype !== null) fail(code, label + ' must be a plain object')
  const names = ownKeys(value)
  for (let index = 0; index < names.length; index++) {
    const key = names[index]
    if (typeof key !== 'string') fail(code, label + ' must use string fields')
    const descriptor = descriptorOf(value, key)!
    if (!owns(descriptor, 'value')) fail(code, label + ' must not contain accessors')
    if (!descriptor.enumerable) fail(code, label + ' fields must be enumerable data')
  }
  return value as Record<string, unknown>
}

export function keys(value: Record<string, unknown>, allowed: readonly string[], label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT', required: readonly string[] = allowed): void {
  const names = ownKeys(value)
  for (let index = 0; index < names.length; index++) {
    if (typeof names[index] !== 'string' || !contains(allowed, names[index] as string)) fail(code, label + ' contains fields outside the v1 contract')
  }
  for (let index = 0; index < required.length; index++) {
    if (!owns(value, required[index])) fail(code, label + ' requires an own ' + required[index] + ' field')
  }
}

export function nonempty(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is string {
  if (typeof value !== 'string' || !hasText(value)) fail(code, label + ' must be a nonempty string')
}

export function array(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is unknown[] {
  if (!value || typeof value !== 'object' || isProxy(value) || !isArray(value)) fail(code, label + ' must be a plain non-proxy array')
  if (prototypeOf(value) !== arrayPrototype) fail(code, label + ' must use this realm standard Array.prototype')
  const length = descriptorOf(value, 'length')
  if (!length || !owns(length, 'value') || length.enumerable || length.configurable || !safeInteger(length.value) || length.value < 0) fail(code, label + ' must have standard own length data')
  const names = ownKeys(value)
  // Key count rejects enormous sparse arrays without a length-sized scan.
  if (names.length !== length.value + 1) fail(code, label + ' must have dense own data indices')
  for (let position = 0; position < names.length; position++) {
    const key = names[position]
    if (key === 'length') continue
    const index = typeof key === 'string' ? numberOf(key) : NaN
    if (typeof key !== 'string' || stringOf(index) !== key || !safeInteger(index) || index < 0 || index >= length.value) fail(code, label + ' contains fields outside a plain array')
    const descriptor = descriptorOf(value, key)!
    if (!owns(descriptor, 'value') || !descriptor.enumerable) fail(code, label + ' indices must be own enumerable data')
  }
}

export function strings(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is string[] {
  array(value, label, code)
  const seen = setOf<string>()
  for (let index = 0; index < value.length; index++) {
    const entry = value[index]
    nonempty(entry, label + ' entry', code)
    if (setHas(seen, entry)) fail(code, label + ' contains duplicate ids')
    setAdd(seen, entry)
  }
}

export function nonnegative(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is number {
  if (typeof value !== 'number' || !safeInteger(value) || value < 0) fail(code, label + ' must be a nonnegative safe integer')
}

function timezoneDate(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = matchData(/^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/, value)
  if (!match || !finite(parseDate(value))) return false
  const year = numberOf(match[1]), month = numberOf(match[2]), day = numberOf(match[3])
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
}

export function assertEvidence(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is Evidence {
  const source = record(value, label, code)
  keys(source, ['id', 'kind', 'reference', 'sha256', 'observedAt', 'revoked', 'scope'], label, code, ['id', 'kind', 'reference', 'observedAt', 'revoked', 'scope'])
  nonempty(source.id, label + '.id', code)
  if (typeof source.kind !== 'string' || !contains(EVIDENCE_KINDS, source.kind)) fail(code, label + '.kind is invalid')
  nonempty(source.reference, label + '.reference', code)
  const digest = owns(source, 'sha256') ? source.sha256 : undefined
  if (digest !== undefined && (typeof digest !== 'string' || !matchData(/^[0-9a-fA-F]{64}$/, digest))) fail(code, label + '.sha256 must be 64 hex characters')
  if (!timezoneDate(source.observedAt)) fail(code, label + '.observedAt must be a valid timestamp with timezone')
  if (typeof source.revoked !== 'boolean') fail(code, label + '.revoked must be boolean')
  const scope = record(source.scope, label + '.scope', code)
  keys(scope, ['agent_scope', 'workspace_scope', 'explicitGlobal'], label + '.scope', code)
  const dimensions = ['agent_scope', 'workspace_scope']
  for (let index = 0; index < dimensions.length; index++) {
    const value = scope[dimensions[index]]
    if (value !== null && typeof value !== 'string') fail(code, label + '.scope dimensions must be string or null')
  }
  if (typeof scope.explicitGlobal !== 'boolean') fail(code, label + '.scope.explicitGlobal must be boolean')
}

export function assertItemShape(value: unknown, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is CheckpointItem {
  const item = record(value, label, code)
  keys(item, ['id', 'text', 'evidenceIds', 'status'], label, code)
  nonempty(item.id, label + '.id', code)
  nonempty(item.text, label + '.text', code)
  strings(item.evidenceIds, label + '.evidenceIds', code)
  if (item.status !== 'confirmed' && item.status !== 'candidate') fail(code, label + '.status is invalid')
}

export function assertItem(value: unknown, evidenceById: ReadonlyMap<string, Evidence>, label: string, code: CheckpointErrorCode = 'INVALID_CHECKPOINT'): asserts value is CheckpointItem {
  assertItemShape(value, label, code)
  if (!value.evidenceIds.length) fail('MISSING_EVIDENCE', label + ' requires evidence ids')
  const sources = mapValues(value.evidenceIds, id => {
    const source = mapGet(evidenceById, id)
    if (!source) fail('MISSING_EVIDENCE', label + ' references evidence that is not stored or supplied')
    return source
  })
  if (value.status === 'confirmed' && (someValue(sources, source => source.kind === 'model') || !someValue(sources, source => !source.revoked && source.kind !== 'model'))) fail('UNTRUSTED_EVIDENCE', label + ' requires live non-model evidence; model sources are candidate-only')
}

export function assertCheckpoint(value: unknown): asserts value is CheckpointSnapshot {
  const snapshot = record(value, 'snapshot')
  keys(snapshot, ['schemaVersion', 'taskId', 'sessionIds', 'revision', 'goal', 'constraints', 'facts', 'completed', 'pending', 'rejected', 'resources', 'evidenceRefs', 'appliedEventIds'], 'snapshot')
  if (snapshot.schemaVersion !== 1) fail('INVALID_CHECKPOINT', 'snapshot.schemaVersion must be 1')
  nonempty(snapshot.taskId, 'snapshot.taskId')
  strings(snapshot.sessionIds, 'snapshot.sessionIds')
  nonnegative(snapshot.revision, 'snapshot.revision')
  strings(snapshot.appliedEventIds, 'snapshot.appliedEventIds')
  array(snapshot.evidenceRefs, 'snapshot.evidenceRefs')
  const evidenceById = mapOf<string, Evidence>()
  for (let index = 0; index < snapshot.evidenceRefs.length; index++) {
    const source = snapshot.evidenceRefs[index]
    assertEvidence(source, 'snapshot.evidenceRefs[' + index + ']')
    if (mapHas(evidenceById, source.id)) fail('INVALID_CHECKPOINT', 'snapshot.evidenceRefs contains duplicate ids')
    mapSet(evidenceById, source.id, source)
  }
  if (snapshot.goal !== null) assertItem(snapshot.goal, evidenceById, 'snapshot.goal')
  for (let categoryIndex = 0; categoryIndex < ARRAY_CATEGORIES.length; categoryIndex++) {
    const category = ARRAY_CATEGORIES[categoryIndex]
    const collection = snapshot[category]
    array(collection, 'snapshot.' + category)
    const seen = setOf<string>()
    for (let index = 0; index < collection.length; index++) {
      const item = collection[index]
      assertItem(item, evidenceById, 'snapshot.' + category + '[' + index + ']')
      if (setHas(seen, item.id)) fail('INVALID_CHECKPOINT', 'snapshot.' + category + ' contains duplicate item ids')
      setAdd(seen, item.id)
    }
  }
  const typed = value as CheckpointSnapshot
  const pending = setOf(mapValues(typed.pending, item => item.id))
  if (someValue(typed.completed, item => setHas(pending, item.id))) fail('INVALID_CHECKPOINT', 'snapshot.pending and snapshot.completed contain overlapping item ids')
}

export function validateCheckpoint(snapshot: unknown): CheckpointValidation {
  try { assertCheckpoint(snapshot); return { ok: true } }
  catch (error) {
    if (error instanceof CheckpointError) return { ok: false, code: error.code, message: error.message }
    return { ok: false, code: 'INVALID_CHECKPOINT', message: 'snapshot must be valid plain v1 data' }
  }
}
