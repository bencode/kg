// registry.jsonl — the single hash↔path ledger.
//
// One JSON object per line, one per current document. A document's identity is
// its content hash. Paths live only here; metadata and edges reference docs by
// hash, so moving/renaming a file only rewrites the registry, never the
// extracted knowledge.

import {
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import * as layout from './layout.js'
import { parse } from './parser.js'
import type { Doc, ScanResult } from './types.js'

export const load = (vault: string): Map<string, Doc> => {
  const out = new Map<string, Doc>()
  const reg = layout.registryPath(vault)
  if (!existsSync(reg)) return out
  for (const line of readFileSync(reg, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const d = JSON.parse(trimmed) as Doc
    out.set(d.hash, d)
  }
  return out
}

export const loadByPath = (vault: string): Map<string, Doc> => {
  const out = new Map<string, Doc>()
  for (const doc of load(vault).values()) out.set(doc.path, doc)
  return out
}

export const save = (vault: string, docs: Doc[]): void => {
  layout.ensureKgDirs(vault)
  const reg = layout.registryPath(vault)
  const lines = [...docs].sort((a, b) => (a.path < b.path ? -1 : 1)).map((d) => JSON.stringify(d))
  const tmp = `${reg}.tmp`
  writeFileSync(tmp, lines.length ? `${lines.join('\n')}\n` : '', 'utf-8')
  renameSync(tmp, reg)
}

const scopePrefixes = (scope: string): string[] | null => {
  if (scope === 'all') return null
  return scope
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

const inScope = (path: string, prefixes: string[] | null): boolean => {
  if (prefixes === null) return true
  return prefixes.some((p) => path === p || path.startsWith(`${p}/`))
}

/** Walk markdown in scope, recompute hashes, rewrite the registry. */
export const scan = (vault: string, scope = 'all'): ScanResult => {
  const prevByPath = loadByPath(vault)
  const docs: Doc[] = []
  const seen = new Set<string>()
  let added = 0
  let changed = 0
  let unchanged = 0
  for (const { rel, abs } of layout.iterMarkdown(vault, scope)) {
    seen.add(rel)
    const stat = statSync(abs)
    const text = readFileSync(abs, 'utf-8')
    const hash = layout.hashBytes(Buffer.from(text, 'utf-8'))
    const title = parse(text, rel).title
    docs.push({ hash, path: rel, title, mtime: stat.mtimeMs / 1000, size: stat.size })
    const prev = prevByPath.get(rel)
    if (prev === undefined) added += 1
    else if (prev.hash !== hash) changed += 1
    else unchanged += 1
  }
  // Carry over out-of-scope docs so a scoped scan never drops them.
  const prefixes = scopePrefixes(scope)
  let deleted = 0
  for (const [path, doc] of prevByPath) {
    if (seen.has(path)) continue
    if (inScope(path, prefixes)) deleted += 1
    else docs.push(doc)
  }
  save(vault, docs)
  return {
    scanned: added + changed + unchanged,
    new: added,
    changed,
    unchanged,
    deleted,
    total: docs.length,
  }
}

export const resolve = (vault: string, docHash: string): Doc | undefined => load(vault).get(docHash)

/** Docs in the registry that have no metadata/<hash>.json yet. */
export const pending = (vault: string, limit?: number): Doc[] => {
  const out: Doc[] = []
  const docs = [...load(vault).values()].sort((a, b) => (a.path < b.path ? -1 : 1))
  for (const doc of docs) {
    if (!existsSync(layout.metadataPath(vault, doc.hash))) {
      out.push(doc)
      if (limit !== undefined && out.length >= limit) break
    }
  }
  return out
}

/** Delete metadata files whose hash is no longer in the registry. */
export const gc = (vault: string): { removed: number; hashes: string[] } => {
  const live = new Set(load(vault).keys())
  const mdir = layout.metadataDir(vault)
  const removed: string[] = []
  if (existsSync(mdir)) {
    for (const name of readdirSync(mdir).sort()) {
      if (!name.endsWith('.json')) continue
      const hash = name.slice(0, -'.json'.length)
      if (!live.has(hash)) {
        unlinkSync(join(mdir, name))
        removed.push(hash)
      }
    }
  }
  return { removed: removed.length, hashes: removed }
}
