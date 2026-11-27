/** Captured host intrinsics plus index-only iteration; no input method/species/iterator lookup. */
import { isDeepStrictEqual, types } from 'node:util'

const invoke = Reflect.apply
const createObject = Object.create
const define = Object.defineProperty
const trim = String.prototype.trim
const executeRegex = RegExp.prototype.exec
const mapGetIntrinsic = Map.prototype.get
const mapSetIntrinsic = Map.prototype.set
const mapHasIntrinsic = Map.prototype.has
const setAddIntrinsic = Set.prototype.add
const setHasIntrinsic = Set.prototype.has
const MapConstructor = Map
const SetConstructor = Set

export const arrayPrototype = Array.prototype
export const objectPrototype = Object.prototype
export const prototypeOf = Object.getPrototypeOf
export const ownKeys = Reflect.ownKeys
export const descriptorOf = Object.getOwnPropertyDescriptor
export const owns = Object.hasOwn
export const isArray = Array.isArray
export const isProxy = types.isProxy
export const safeInteger = Number.isSafeInteger
export const finite = Number.isFinite
export const numberOf = Number
export const stringOf = String
export const parseDate = Date.parse
export const cloneData = structuredClone
export const freezeData = Object.freeze
export const equalData = isDeepStrictEqual

export function hasText(value: string): boolean {
  return invoke(trim, value, []).length > 0
}
export function matchData(pattern: RegExp, value: string): RegExpExecArray | null {
  return invoke(executeRegex, pattern, [value])
}
export function append<T>(values: T[], value: T): void {
  const descriptor = createObject(null) as PropertyDescriptor
  descriptor.value = value
  descriptor.enumerable = true
  descriptor.configurable = true
  descriptor.writable = true
  define(values, stringOf(values.length), descriptor)
}
export function mapValues<T, R>(values: readonly T[], mapper: (value: T, index: number) => R): R[] {
  const result: R[] = []
  for (let index = 0; index < values.length; index++) append(result, mapper(values[index], index))
  return result
}
export function someValue<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): boolean {
  for (let index = 0; index < values.length; index++) if (predicate(values[index], index)) return true
  return false
}
export function filterValues<T>(values: readonly T[], predicate: (value: T, index: number) => boolean): T[] {
  const result: T[] = []
  for (let index = 0; index < values.length; index++) if (predicate(values[index], index)) append(result, values[index])
  return result
}
export function indexWhere<T>(values: readonly T[], predicate: (value: T) => boolean): number {
  for (let index = 0; index < values.length; index++) if (predicate(values[index])) return index
  return -1
}
export function contains<T>(values: readonly T[], value: T): boolean {
  return someValue(values, entry => entry === value)
}
export function joinText(values: readonly string[], separator: string): string {
  let result = ''
  for (let index = 0; index < values.length; index++) result += (index === 0 ? '' : separator) + values[index]
  return result
}
export function sortValues<T>(values: readonly T[], compare: (left: T, right: T) => number): T[] {
  const result = mapValues(values, value => value)
  for (let index = 1; index < result.length; index++) {
    const entry = result[index]
    let position = index
    while (position > 0 && compare(result[position - 1], entry) > 0) { result[position] = result[position - 1]; position-- }
    result[position] = entry
  }
  return result
}
export function removeAt<T>(values: T[], index: number): void {
  for (let position = index; position + 1 < values.length; position++) values[position] = values[position + 1]
  values.length -= 1
}
export function setOf<T>(values: readonly T[] = []): Set<T> {
  const result = new SetConstructor<T>()
  for (let index = 0; index < values.length; index++) setAdd(result, values[index])
  return result
}
export function setAdd<T>(target: Set<T>, value: T): void { invoke(setAddIntrinsic, target, [value]) }
export function setHas<T>(target: ReadonlySet<T>, value: T): boolean { return invoke(setHasIntrinsic, target, [value]) }
export function mapOf<K, V>(entries: readonly (readonly [K, V])[] = []): Map<K, V> {
  const result = new MapConstructor<K, V>()
  for (let index = 0; index < entries.length; index++) mapSet(result, entries[index][0], entries[index][1])
  return result
}
export function mapGet<K, V>(target: ReadonlyMap<K, V>, key: K): V | undefined { return invoke(mapGetIntrinsic, target, [key]) }
export function mapSet<K, V>(target: Map<K, V>, key: K, value: V): void { invoke(mapSetIntrinsic, target, [key, value]) }
export function mapHas<K, V>(target: ReadonlyMap<K, V>, key: K): boolean { return invoke(mapHasIntrinsic, target, [key]) }
export function uniqueValues<T>(values: readonly T[]): T[] {
  const seen = setOf<T>()
  const result: T[] = []
  for (let index = 0; index < values.length; index++) if (!setHas(seen, values[index])) { setAdd(seen, values[index]); append(result, values[index]) }
  return result
}
