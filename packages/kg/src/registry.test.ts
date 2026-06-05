import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as layout from './layout.js'
import * as registry from './registry.js'
import { makeVault, removeVault } from './testing.js'

let vault: string
beforeEach(() => {
  vault = makeVault()
})
afterEach(() => {
  removeVault(vault)
})

test('scan counts new then unchanged', () => {
  const r1 = registry.scan(vault, 'knowledge')
  expect(r1.new).toBe(2)
  expect(r1.total).toBe(2)
  const r2 = registry.scan(vault, 'knowledge')
  expect(r2.new).toBe(0)
  expect(r2.unchanged).toBe(2)
})

test('scan detects change', () => {
  registry.scan(vault, 'knowledge')
  writeFileSync(join(vault, 'knowledge', 'a.md'), '# Doc A\n\nchanged.\n', 'utf-8')
  const r = registry.scan(vault, 'knowledge')
  expect(r.changed).toBe(1)
  expect(r.unchanged).toBe(1)
})

test('resolve and pending', () => {
  registry.scan(vault, 'knowledge')
  const h = registry.loadByPath(vault).get('knowledge/a.md')!.hash
  expect(registry.resolve(vault, h)?.path).toBe('knowledge/a.md')
  expect(registry.pending(vault)).toHaveLength(2)
})

test('gc removes orphan metadata', () => {
  registry.scan(vault, 'knowledge')
  layout.ensureKgDirs(vault)
  writeFileSync(layout.metadataPath(vault, 'deadbeef'), '{}', 'utf-8')
  const res = registry.gc(vault)
  expect(res.removed).toBe(1)
  expect(res.hashes).toContain('deadbeef')
})

test('out-of-scope docs preserved on scoped rescan', () => {
  mkdirSync(join(vault, 'journal'))
  writeFileSync(join(vault, 'journal', 'j.md'), '# J\n', 'utf-8')
  registry.scan(vault, 'all')
  expect(registry.load(vault).size).toBe(3)
  registry.scan(vault, 'knowledge')
  const paths = new Set([...registry.load(vault).values()].map((d) => d.path))
  expect(paths).toContain('journal/j.md')
})
