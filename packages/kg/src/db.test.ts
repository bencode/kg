import { existsSync, unlinkSync } from 'node:fs'
import { afterEach, beforeEach, expect, test } from 'vitest'
import * as concepts from './concepts.js'
import * as dbmod from './db.js'
import * as dbbuild from './dbbuild.js'
import * as metadata from './metadata.js'
import * as queries from './queries.js'
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
    { canonical: 'TextGrad', type: 'method' },
    { canonical: 'SkillOpt', type: 'paper' },
  ])
  const ha = registry.loadByPath(vault).get('knowledge/a.md')!.hash
  metadata.importDoc(vault, {
    hash: ha,
    mentions: [{ concept: 'RAG', anchor: { quote: 'Discusses RAG' } }],
    relations: [
      {
        from: 'SkillOpt',
        relation: 'builds_on',
        to: 'TextGrad',
        anchor: { quote: 'Discusses RAG' },
        method: 'llm',
        confidence: 0.9,
      },
    ],
  })
  return ha
}

test('build and stats', () => {
  seed()
  const res = dbbuild.build(vault)
  expect(res.documents).toBe(2)
  expect(res.entities).toBe(3)
  const st = queries.stats(vault)
  expect(st.edges).toBeGreaterThanOrEqual(2)
  expect(st.entities_by_type.paper).toBe(1)
})

test('entity aggregation + alias resolution', () => {
  seed()
  dbbuild.build(vault)
  const e = queries.entity(vault, 'SkillOpt')
  expect(e!.out_edges.map((x) => x.relation)).toContain('builds_on')
  expect(queries.entity(vault, '检索增强生成')!.entity.name).toBe('RAG')
})

test('entity edges carry source doc + summary/aliases fields', () => {
  seed()
  dbbuild.build(vault)
  const e = queries.entity(vault, 'SkillOpt')
  expect(e!.out_edges[0]!.source?.path).toBe('knowledge/a.md')
  expect(e!.entity).toHaveProperty('aliases')
})

test('search cjk-tokenized fts', () => {
  seed()
  dbbuild.build(vault)
  const hits = queries.search(vault, 'retrieval', 5).map((h) => h.path)
  expect(hits).toContain('knowledge/b.md')
  expect(queries.search(vault, 'retrieval', 5)[0]!.hash).toBeTruthy()
})

test('paths between entities', () => {
  seed()
  dbbuild.build(vault)
  const chain = queries.paths(vault, 'SkillOpt', 'TextGrad')
  expect(chain!.length).toBeGreaterThan(0)
  const last = chain!.at(-1)!.node
  expect(last.kind === 'entity' && last.name).toBe('TextGrad')
})

test('edge detail carries anchor and source', () => {
  seed()
  dbbuild.build(vault)
  const g = queries.exportGraph(vault)
  const rel = g.edges.find((e) => e.relation === 'builds_on')!
  const details = queries.edgeDetail(vault, rel.source, rel.target, 'builds_on')
  expect(details[0]!.anchor).toBe('Discusses RAG')
  expect(details[0]!.source?.path).toBe('knowledge/a.md')
  expect(queries.edgeDetail(vault, 'x:1', 'e:2')).toEqual([])
})

test('index missing raises', () => {
  registry.scan(vault, 'knowledge')
  expect(() => queries.stats(vault)).toThrowError(queries.IndexMissing)
})

test('rebuild from files is deterministic (db disposable)', () => {
  seed()
  const r1 = dbbuild.build(vault)
  const e1 = queries.entity(vault, 'RAG')
  unlinkSync(dbmod.dbPathFor(vault))
  const r2 = dbbuild.build(vault)
  expect(r2.edges).toBe(r1.edges)
  expect(queries.entity(vault, 'RAG')).toEqual(e1)
})
