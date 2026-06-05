// Viewer API layer: hash whitelisting, locate, qa spotting (mirrors Python test_api.py).

import { existsSync, unlinkSync } from 'node:fs'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as api from './api.js'
import * as concepts from './concepts.js'
import * as dbmod from './db.js'
import * as dbbuild from './dbbuild.js'
import * as metadata from './metadata.js'
import * as registry from './registry.js'
import { makeVault, removeVault } from './testing.js'

let vault: string
beforeEach(() => {
  vault = makeVault()
})
afterEach(() => {
  const dbPath = dbmod.dbPathFor(vault)
  for (const ext of ['', '-wal', '-shm']) {
    if (existsSync(`${dbPath}${ext}`)) unlinkSync(`${dbPath}${ext}`)
  }
  removeVault(vault)
})

const seed = (): string => {
  registry.scan(vault, 'knowledge')
  concepts.mergeImport(vault, [
    { canonical: 'RAG', type: 'concept', aliases: ['检索增强生成'] },
    { canonical: 'GraphRAG', type: 'method' },
    { canonical: 'Product Hunt', type: 'reference', aliases: ['PH'] },
  ])
  const ha = registry.loadByPath(vault).get('knowledge/a.md')!.hash
  metadata.importDoc(vault, {
    hash: ha,
    mentions: [{ concept: 'RAG', anchor: { quote: 'Discusses RAG' } }],
    relations: [
      {
        from: 'GraphRAG',
        relation: 'builds_on',
        to: 'RAG',
        anchor: { quote: 'Discusses RAG' },
        method: 'llm',
        confidence: 0.9,
      },
    ],
  })
  dbbuild.build(vault)
  return ha
}

test('rawText is hash-whitelisted', () => {
  const ha = seed()
  expect(api.rawText(vault, ha)).toContain('Doc A')
  expect(() => api.rawText(vault, 'deadbeef')).toThrowError(api.DocNotFound)
  expect(() => api.rawText(vault, '../../../etc/passwd')).toThrowError(api.DocNotFound)
})

test('docInfo carries path, vscode url, and metadata', () => {
  const ha = seed()
  const info = api.docInfo(vault, ha)
  expect(info.path).toBe('knowledge/a.md')
  expect(info.vscode_url.startsWith('vscode://file/')).toBe(true)
  expect(info.metadata!.mentions![0]!.concept).toBe('RAG')
})

test('locate finds verbatim quote line', () => {
  const ha = seed()
  const res = api.locate(vault, ha, 'Discusses RAG')
  expect(res.found).toBe(true)
  expect(res.line).toBe(3)
  expect(api.locate(vault, ha, '幻觉引文').found).toBe(false)
})

test('qa entity spotting respects ascii word boundaries', () => {
  seed()
  const res = api.qa(vault, 'RAG 和 GraphRAG 什么关系')
  const names = res.entities.map((e) => e.entity.name)
  expect(names).toContain('RAG')
  expect(names).toContain('GraphRAG')
  expect(names).not.toContain('Product Hunt') // alias "PH" must not fire inside "graphrag"
  expect(res.hits.length).toBeGreaterThan(0) // entity-name fallback search
})
