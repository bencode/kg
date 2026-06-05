import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as concepts from './concepts.js'
import * as layout from './layout.js'
import * as metadata from './metadata.js'
import * as registry from './registry.js'
import { makeVault, removeVault } from './testing.js'
import type { MetadataRecord } from './types.js'

let vault: string
beforeEach(() => {
  vault = makeVault()
})
afterEach(() => {
  removeVault(vault)
})

const hashOf = (rel: string): string => {
  registry.scan(vault, 'knowledge')
  return registry.loadByPath(vault).get(rel)!.hash
}

test('verbatim anchor accepted', () => {
  const h = hashOf('knowledge/a.md')
  concepts.mergeImport(vault, [{ canonical: 'RAG' }])
  const res = metadata.importDoc(vault, {
    hash: h,
    mentions: [{ concept: 'RAG', anchor: { quote: 'Discusses RAG and links to' } }],
  })
  expect(res.mentions).toBe(1)
})

test('non-verbatim anchor rejected', () => {
  const h = hashOf('knowledge/a.md')
  concepts.mergeImport(vault, [{ canonical: 'RAG' }])
  const rec: MetadataRecord = {
    hash: h,
    mentions: [{ concept: 'RAG', anchor: { quote: 'this text is not in the doc' } }],
  }
  expect(() => metadata.importDoc(vault, rec)).toThrowError(metadata.ValidationError)
  try {
    metadata.importDoc(vault, rec)
  } catch (e) {
    expect((e as metadata.ValidationError).problems.some((p) => p.includes('verbatim'))).toBe(true)
  }
})

test('unknown concept rejected then autocreated', () => {
  const h = hashOf('knowledge/a.md')
  const rec: MetadataRecord = {
    hash: h,
    mentions: [{ concept: 'Voyager', anchor: { quote: 'Discusses RAG' } }],
  }
  expect(() => metadata.importDoc(vault, rec)).toThrowError(metadata.ValidationError)
  const res = metadata.importDoc(vault, rec, { createMissing: true })
  expect(res.mentions).toBe(1)
  expect(concepts.resolve(vault, 'Voyager')).toBeDefined()
})

test('import merges with existing (LLM layer must not clobber structural)', () => {
  const h = hashOf('knowledge/a.md')
  concepts.mergeImport(vault, [{ canonical: 'RAG' }, { canonical: 'B' }])
  metadata.importDoc(vault, {
    hash: h,
    doc_links: [{ to_hash: 'x' }],
    mentions: [{ concept: 'RAG', anchor: { quote: 'Discusses RAG' } }],
  })
  metadata.importDoc(vault, {
    hash: h,
    mentions: [{ concept: 'B', anchor: { quote: 'links to' } }],
  })
  const rec = JSON.parse(readFileSync(layout.metadataPath(vault, h), 'utf-8')) as MetadataRecord
  expect(rec.mentions).toHaveLength(2)
  expect(rec.doc_links).toHaveLength(1) // preserved from first import
})

test('validate_all flags orphan after source mutation', () => {
  const h = hashOf('knowledge/a.md')
  concepts.mergeImport(vault, [{ canonical: 'RAG' }])
  metadata.importDoc(vault, {
    hash: h,
    mentions: [{ concept: 'RAG', anchor: { quote: 'Discusses RAG' } }],
  })
  writeFileSync(join(vault, 'knowledge', 'a.md'), '# changed\n', 'utf-8')
  registry.scan(vault, 'knowledge')
  const res = metadata.validateAll(vault)
  expect(res.orphans).toContain(h)
})
