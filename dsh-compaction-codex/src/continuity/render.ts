import { CheckpointError } from './types.js'
import type { CheckpointAccessContext, CheckpointItem, CheckpointSnapshot, Evidence, RenderCheckpointResult } from './types.js'
import { ARRAY_CATEGORIES, array, assertCheckpoint, keys, nonempty, nonnegative, record } from './validation.js'
import { owns, freezeData, hasText, mapValues, someValue, filterValues, append, joinText, sortValues, mapOf, mapGet, setOf, setHas, uniqueValues } from './intrinsics.js'

type Category = 'goal' | typeof ARRAY_CATEGORIES[number]
interface Entry { category: Category; item: CheckpointItem; block: string; critical: boolean }
const CATEGORIES: readonly Category[] = freezeData(['goal', 'constraints', 'facts', 'completed', 'pending', 'rejected', 'resources'])

function access(value: unknown): CheckpointAccessContext {
  const context = record(value, 'accessContext', 'INVALID_INPUT')
  keys(context, ['authorizedScopes', 'allowExplicitGlobal'], 'accessContext', 'INVALID_INPUT')
  array(context.authorizedScopes, 'accessContext.authorizedScopes', 'INVALID_INPUT')
  if (typeof context.allowExplicitGlobal !== 'boolean') throw new CheckpointError('INVALID_INPUT', 'accessContext.allowExplicitGlobal must be boolean')
  for (let index = 0; index < context.authorizedScopes.length; index++) {
    const pair = record(context.authorizedScopes[index], 'authorizedScopes entry', 'INVALID_INPUT')
    keys(pair, ['agent_scope', 'workspace_scope'], 'authorizedScopes entry', 'INVALID_INPUT')
    nonempty(pair.agent_scope, 'authorizedScopes.agent_scope', 'INVALID_INPUT')
    nonempty(pair.workspace_scope, 'authorizedScopes.workspace_scope', 'INVALID_INPUT')
  }
  return value as CheckpointAccessContext
}

function authorized(source: Evidence, context: CheckpointAccessContext): boolean {
  if (source.revoked) return false
  const scope = source.scope
  if (scope.agent_scope === null && scope.workspace_scope === null) return scope.explicitGlobal && context.allowExplicitGlobal
  if (typeof scope.agent_scope !== 'string' || !hasText(scope.agent_scope) || typeof scope.workspace_scope !== 'string' || !hasText(scope.workspace_scope)) return false
  return someValue(context.authorizedScopes, pair => pair.agent_scope === scope.agent_scope && pair.workspace_scope === scope.workspace_scope)
}

function block(item: CheckpointItem, sources: Evidence[]): string {
  const lines = ['id: ' + item.id, 'status: ' + item.status, item.text, 'evidence:']
  for (let index = 0; index < sources.length; index++) {
    const source = sources[index]
    const digest = owns(source, 'sha256') ? source.sha256 : undefined
    append(lines, source.id + ' [' + source.kind + '] ' + source.reference + ' @ ' + source.observedAt + (digest === undefined ? '' : ' sha256=' + digest))
  }
  return joinText(lines, '\n')
}

function compose(snapshot: CheckpointSnapshot, entries: Entry[], selected: ReadonlySet<Entry>): string {
  const header = ['schemaVersion: 1', 'taskId: ' + snapshot.taskId, 'revision: ' + snapshot.revision]
  for (let index = 0; index < snapshot.sessionIds.length; index++) append(header, 'sessionId: ' + snapshot.sessionIds[index])
  const sections = mapValues(CATEGORIES, category => {
    const blocks = mapValues(filterValues(entries, entry => entry.category === category && setHas(selected, entry)), entry => '\n' + entry.block)
    return '[' + category + ']' + joinText(blocks, '')
  })
  return joinText(header, '\n') + '\n\n' + joinText(sections, '\n\n')
}

function failure(error: CheckpointError): RenderCheckpointResult {
  return { ok: false, text: '', requiredChars: 0, overflow: false, omittedCandidateIds: [], code: error.code, message: error.message }
}

/** No inherited input method lookup, implicit authorization, slicing, or revoked-source output. */
export function renderCheckpoint(snapshot: unknown, options: { maxChars: number; accessContext: CheckpointAccessContext }): RenderCheckpointResult {
  try {
    assertCheckpoint(snapshot)
    const settings = record(options, 'options', 'INVALID_INPUT')
    keys(settings, ['maxChars', 'accessContext'], 'options', 'INVALID_INPUT')
    nonnegative(settings.maxChars, 'options.maxChars', 'INVALID_INPUT')
    const context = access(settings.accessContext)
    const evidenceById = mapOf<string, Evidence>(mapValues(snapshot.evidenceRefs, source => [source.id, source] as const))
    const entries: Entry[] = []
    const candidates: CheckpointItem[] = []
    for (let categoryIndex = 0; categoryIndex < CATEGORIES.length; categoryIndex++) {
      const category = CATEGORIES[categoryIndex]
      const items = category === 'goal' ? (snapshot.goal === null ? [] : [snapshot.goal]) : snapshot[category]
      for (let index = 0; index < items.length; index++) {
        const item = items[index]
        if (item.status === 'candidate') append(candidates, item)
        const sources = filterValues(mapValues(item.evidenceIds, id => mapGet(evidenceById, id)!), source => !source.revoked)
        if (!sources.length || someValue(sources, source => !authorized(source, context))) {
          if (item.status === 'confirmed') return failure(new CheckpointError('PERMISSION_DENIED', 'Access to confirmed checkpoint items is not authorized'))
          continue
        }
        append(entries, { category, item, block: block(item, sources), critical: item.status === 'confirmed' || category === 'constraints' || category === 'rejected' })
      }
    }
    const selected = setOf(filterValues(entries, entry => entry.critical))
    const requiredChars = compose(snapshot, entries, selected).length
    const omitted = () => uniqueValues(mapValues(filterValues(candidates, item => !someValue(entries, entry => entry.item === item && setHas(selected, entry))), item => item.id))
    if (requiredChars > settings.maxChars) return { ok: false, text: '', requiredChars, overflow: true, omittedCandidateIds: mapValues(candidates, item => item.id), code: 'BUDGET_EXCEEDED', message: 'Render budget cannot hold all critical checkpoint text and identifiers' }
    let chars = requiredChars
    const optional = sortValues(filterValues(entries, entry => !entry.critical), (a, b) => a.block.length - b.block.length)
    for (let index = 0; index < optional.length; index++) {
      const entry = optional[index]
      if (chars + entry.block.length + 1 <= settings.maxChars) {
        // setOf/add use captured Set intrinsics, never a caller-modified prototype method.
        addSelected(selected, entry)
        chars += entry.block.length + 1
      }
    }
    return { ok: true, text: compose(snapshot, entries, selected), requiredChars, overflow: false, omittedCandidateIds: omitted() }
  } catch (error) {
    if (error instanceof CheckpointError) return failure(error)
    return failure(new CheckpointError('INVALID_INPUT', 'Render requires valid plain checkpoint data and explicit options'))
  }
}

import { setAdd as addSelected } from './intrinsics.js'
