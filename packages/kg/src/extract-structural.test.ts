import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as concepts from './concepts.js'
import * as ex from './extract-structural.js'
import * as registry from './registry.js'
import { makeVault, removeVault } from './testing.js'

let vault: string
beforeEach(() => {
  vault = makeVault()
})
afterEach(() => {
  removeVault(vault)
})

test('arxiv guard rejects date-like ids', () => {
  const text = 'real 2605.18747v1 2305.16291 ; fake 0324.1227 0365.25006 1213.1925'
  const ids = ex.findArxivIds(text).map(([id]) => id)
  expect(ids).toContain('2605.18747v1')
  expect(ids).toContain('2305.16291')
  expect(ids).not.toContain('0324.1227') // month 24
  expect(ids).not.toContain('0365.25006') // month 65
  expect(ids).not.toContain('1213.1925') // month 13
})

test('links resolve to target hash', () => {
  registry.scan(vault, 'knowledge')
  const rec = ex.extract(vault, 'knowledge/a.md')
  expect(rec.doc_links).toHaveLength(1)
  const bHash = registry.loadByPath(vault).get('knowledge/b.md')!.hash
  expect(rec.doc_links![0]!.to_hash).toBe(bHash)
})

const makeRoam = (vault: string): void => {
  const r = join(vault, 'roam')
  mkdirSync(r)
  writeFileSync(join(r, 'Clojure.md'), '- Lisp dialect on the JVM\n', 'utf-8')
  writeFileSync(
    join(r, 'June 1st, 2022.md'),
    '- studied [[Clojure]] macros\n- [[TODO]] write notes\n- read about [[RAG]]\n- saw [[幽灵页面]]\n',
    'utf-8',
  )
}

test('wiki links resolve to docs by title and to existing concepts', () => {
  makeRoam(vault)
  mkdirSync(join(vault, 'meta', 'kg'), { recursive: true })
  writeFileSync(
    join(vault, 'meta', 'kg', 'config.json'),
    JSON.stringify({ wikiLinkStoplist: ['TODO'] }),
    'utf-8',
  )
  concepts.mergeImport(vault, [{ canonical: 'RAG', type: 'concept' }])
  registry.scan(vault, 'knowledge,roam')

  const rec = ex.extract(vault, 'roam/June 1st, 2022.md')
  const clojureHash = registry.loadByPath(vault).get('roam/Clojure.md')!.hash
  expect(rec.doc_links!.map((d) => d.to_hash)).toEqual([clojureHash])
  expect(rec.doc_links![0]!.raw).toBe('[[Clojure]]')

  const mention = (rec.mentions ?? []).find((m) => m.concept === 'rag')
  expect(mention).toBeDefined()
  expect(mention!.anchor!.quote).toBe('- read about [[RAG]]')

  const dangling = rec._dangling ?? []
  expect(dangling).toContain('[[幽灵页面]]')
  expect(dangling).not.toContain('[[TODO]]') // stoplisted, not dangling
})

test('ambiguous wiki-link titles are skipped, same-dir wins', () => {
  makeRoam(vault)
  const other = join(vault, 'other')
  mkdirSync(other)
  writeFileSync(join(other, 'Clojure.md'), '- another Clojure page elsewhere\n', 'utf-8')
  registry.scan(vault, 'knowledge,roam,other')

  // from roam/: two global candidates, but exactly one sibling → same-dir wins
  const rec = ex.extract(vault, 'roam/June 1st, 2022.md')
  const roamHash = registry.loadByPath(vault).get('roam/Clojure.md')!.hash
  expect(rec.doc_links!.map((d) => d.to_hash)).toEqual([roamHash])

  // from a third dir: two candidates, none sibling → ambiguous, skipped
  const k = join(vault, 'knowledge')
  writeFileSync(join(k, 'c.md'), '# Doc C\n\nmentions [[Clojure]]\n', 'utf-8')
  registry.scan(vault, 'knowledge,roam,other')
  const recC = ex.extract(vault, 'knowledge/c.md')
  expect(recC.doc_links).toHaveLength(0)
  expect(recC._dangling).toContain('[[Clojure]]')
})

test('structural emits arxiv mentions with month guard', () => {
  registry.scan(vault, 'knowledge')
  const rec = ex.extract(vault, 'knowledge/a.md')
  const named = new Set((rec.mentions ?? []).map((m) => m.concept))
  expect(named).toContain('arxiv:2605.18747v1')
  expect([...named].every((c) => !c.startsWith('arxiv:0324'))).toBe(true)
})
