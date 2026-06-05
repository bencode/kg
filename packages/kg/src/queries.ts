// Read-only graph queries over the SQLite index.
//
// Validates the index is present and schema-current (IndexMissing/IndexStale)
// so the CLI can map them to exit codes 3/4.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import * as conceptsMod from './concepts.js';
import type { Db } from './db.js';
import * as dbmod from './db.js';
import { tokenizeQuery } from './tokenize.js';
import type { EdgeIn, EdgeOut, EntityAggregate, GraphExport, NodeRef, SourceDoc } from './types.js';

export class IndexMissing extends Error {}
export class IndexStale extends Error {}

type EntityRow = {
  id: number;
  cid: string;
  canonical: string;
  display: string;
  type: string;
  mention_count: number;
};

type DocRow = { id: number; hash: string; path: string; title: string };

type DbEdgeRow = {
  src_kind: string;
  src_id: number;
  dst_kind: string;
  dst_id: number;
  relation_type: string;
  source_doc_id: number;
  confidence: number;
  method: string;
  anchor: string | null;
  raw: string | null;
};

const open = (vault: string): Db => {
  const path = dbmod.dbPathFor(resolve(vault));
  if (!existsSync(path)) {
    throw new IndexMissing(`no index at ${path}; run \`kg db build ${vault}\``);
  }
  const db = dbmod.connect(path);
  if (dbmod.schemaVersion(db) !== dbmod.SCHEMA_VERSION) {
    throw new IndexStale('index schema outdated; run `kg db build`');
  }
  return db;
};

const entityRow = (db: Db, name: string, vault?: string): EntityRow | undefined => {
  const n = conceptsMod.norm(name);
  const row = db
    .prepare('SELECT * FROM entities WHERE cid=? OR lower(canonical)=? OR lower(display)=?')
    .get(name, n, n) as EntityRow | undefined;
  if (row !== undefined || vault === undefined) return row;
  // Fall back to the concept table's alias index (the single source of truth
  // for aliases — the DB stores entities, concepts.json stores their aliases).
  const c = conceptsMod.resolve(vault, name);
  if (c === undefined) return undefined;
  return db.prepare('SELECT * FROM entities WHERE cid=?').get(c.id) as EntityRow | undefined;
};

export type Stats = {
  db_path: string;
  documents: number;
  entities: number;
  edges: number;
  entities_by_type: Record<string, number>;
  edges_by_method: Record<string, number>;
};

export const stats = (vault: string): Stats => {
  const db = open(vault);
  const byType: Record<string, number> = {};
  for (const r of db.prepare('SELECT type, count(*) n FROM entities GROUP BY type').all() as Array<{
    type: string;
    n: number;
  }>) {
    byType[r.type] = r.n;
  }
  const byMethod: Record<string, number> = {};
  for (const r of db
    .prepare('SELECT method, count(*) n FROM edges GROUP BY method')
    .all() as Array<{
    method: string;
    n: number;
  }>) {
    byMethod[r.method] = r.n;
  }
  const count = (sql: string): number => (db.prepare(sql).get() as { n: number }).n;
  return {
    db_path: dbmod.dbPathFor(resolve(vault)),
    documents: count('SELECT count(*) n FROM documents'),
    entities: count('SELECT count(*) n FROM entities'),
    edges: count('SELECT count(*) n FROM edges'),
    entities_by_type: byType,
    edges_by_method: byMethod,
  };
};

export type SearchHit = { hash: string; path: string; title: string; score: number };

export const search = (vault: string, query: string, limit = 20): SearchHit[] => {
  const db = open(vault);
  const match = tokenizeQuery(query);
  const rows = db
    .prepare(
      'SELECT d.hash, d.path, d.title, bm25(documents_fts) AS score ' +
        'FROM documents_fts JOIN documents d ON d.id = documents_fts.rowid ' +
        'WHERE documents_fts MATCH ? ORDER BY score LIMIT ?',
    )
    .all(match, limit) as Array<{ hash: string; path: string; title: string; score: number }>;
  return rows.map((r) => ({ ...r, score: Math.round(r.score * 1000) / 1000 }));
};

const label = (db: Db, kind: string, eid: number): NodeRef => {
  if (kind === 'entity') {
    const r = db.prepare('SELECT canonical, type FROM entities WHERE id=?').get(eid) as
      | { canonical: string; type: string }
      | undefined;
    return { kind: 'entity', name: r?.canonical ?? String(eid), type: r?.type ?? '' };
  }
  const r = db.prepare('SELECT path, title, hash FROM documents WHERE id=?').get(eid) as
    | { path: string; title: string; hash: string }
    | undefined;
  return { kind: 'doc', title: r?.title ?? String(eid), path: r?.path ?? '', hash: r?.hash ?? '' };
};

const sourceDoc = (db: Db, docId: number): SourceDoc | null => {
  const r = db.prepare('SELECT hash, path, title FROM documents WHERE id=?').get(docId) as
    | SourceDoc
    | undefined;
  return r ?? null;
};

export const entity = (vault: string, name: string): EntityAggregate | null => {
  const db = open(vault);
  const e = entityRow(db, name, vault);
  if (e === undefined) return null;
  const outEdges: EdgeOut[] = [];
  const inEdges: EdgeIn[] = [];
  for (const r of db
    .prepare("SELECT * FROM edges WHERE src_kind='entity' AND src_id=? ORDER BY confidence DESC")
    .all(e.id) as DbEdgeRow[]) {
    outEdges.push({
      relation: r.relation_type,
      to: label(db, r.dst_kind, r.dst_id),
      method: r.method,
      confidence: r.confidence,
      anchor: r.anchor,
      source: sourceDoc(db, r.source_doc_id),
    });
  }
  for (const r of db
    .prepare("SELECT * FROM edges WHERE dst_kind='entity' AND dst_id=? ORDER BY confidence DESC")
    .all(e.id) as DbEdgeRow[]) {
    inEdges.push({
      relation: r.relation_type,
      from: label(db, r.src_kind, r.src_id),
      method: r.method,
      confidence: r.confidence,
      anchor: r.anchor,
      source: sourceDoc(db, r.source_doc_id),
    });
  }
  const concept = conceptsMod.load(vault).find((c) => c.id === e.cid);
  return {
    entity: {
      name: e.canonical,
      type: e.type,
      mention_count: e.mention_count,
      summary: concept?.summary ?? '',
      aliases: concept?.aliases ?? [],
    },
    out_edges: outEdges,
    in_edges: inEdges,
  };
};

export type Neighbor = NodeRef & { relation: string; depth: number };

export const neighbors = (vault: string, name: string, depth = 1): Neighbor[] => {
  const db = open(vault);
  const e = entityRow(db, name, vault);
  if (e === undefined) return [];
  const seen = new Set([`entity:${e.id}`]);
  const queue: Array<{ kind: string; id: number; d: number }> = [
    { kind: 'entity', id: e.id, d: 0 },
  ];
  const out: Neighbor[] = [];
  const q = db.prepare(
    'SELECT * FROM edges WHERE (src_kind=? AND src_id=?) OR (dst_kind=? AND dst_id=?)',
  );
  while (queue.length) {
    const { kind, id, d } = queue.shift()!;
    if (d >= depth) continue;
    for (const r of q.all(kind, id, kind, id) as DbEdgeRow[]) {
      const isSrc = r.src_kind === kind && r.src_id === id;
      const nxtKind = isSrc ? r.dst_kind : r.src_kind;
      const nxtId = isSrc ? r.dst_id : r.src_id;
      const key = `${nxtKind}:${nxtId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ ...label(db, nxtKind, nxtId), relation: r.relation_type, depth: d + 1 });
      queue.push({ kind: nxtKind, id: nxtId, d: d + 1 });
    }
  }
  return out;
};

export type PathStep = { node: NodeRef; via: string | null };

export const paths = (vault: string, a: string, b: string, maxHops = 4): PathStep[] | null => {
  const db = open(vault);
  const ea = entityRow(db, a, vault);
  const eb = entityRow(db, b, vault);
  if (ea === undefined || eb === undefined) return null;
  const keyOf = (kind: string, id: number): string => `${kind}:${id}`;
  const start = keyOf('entity', ea.id);
  const goal = keyOf('entity', eb.id);
  const prev = new Map<string, { from: string; via: string } | null>([[start, null]]);
  const queue: Array<{ kind: string; id: number; d: number }> = [
    { kind: 'entity', id: ea.id, d: 0 },
  ];
  const q = db.prepare(
    'SELECT * FROM edges WHERE (src_kind=? AND src_id=?) OR (dst_kind=? AND dst_id=?)',
  );
  let found = false;
  while (queue.length) {
    const { kind, id, d } = queue.shift()!;
    if (keyOf(kind, id) === goal) {
      found = true;
      break;
    }
    if (d >= maxHops) continue;
    for (const r of q.all(kind, id, kind, id) as DbEdgeRow[]) {
      const isSrc = r.src_kind === kind && r.src_id === id;
      const nxtKind = isSrc ? r.dst_kind : r.src_kind;
      const nxtId = isSrc ? r.dst_id : r.src_id;
      const key = keyOf(nxtKind, nxtId);
      if (!prev.has(key)) {
        prev.set(key, { from: keyOf(kind, id), via: r.relation_type });
        queue.push({ kind: nxtKind, id: nxtId, d: d + 1 });
      }
    }
  }
  if (!found && !prev.has(goal)) return [];
  const chain: PathStep[] = [];
  let cur: string | null = goal;
  while (cur !== null) {
    const step: { from: string; via: string } | null = prev.get(cur) ?? null;
    const [kind, idStr] = cur.split(':') as [string, string];
    chain.push({ node: label(db, kind, Number(idStr)), via: step?.via ?? null });
    cur = step?.from ?? null;
  }
  chain.reverse();
  return chain;
};

export type EdgeDetail = {
  from: NodeRef;
  to: NodeRef;
  relation: string;
  method: string;
  confidence: number;
  anchor: string | null;
  raw: string | null;
  source: SourceDoc | null;
};

/** Anchors for the edge(s) between two export-style node ids ("e:5", "d:12"). */
export const edgeDetail = (
  vault: string,
  source: string,
  target: string,
  relation?: string | null,
): EdgeDetail[] => {
  const db = open(vault);
  const kinds: Record<string, string> = { e: 'entity', d: 'doc' };
  const parseRef = (s: string): [string, number] | null => {
    const [k, idStr] = s.split(':');
    const kind = k !== undefined ? kinds[k] : undefined;
    const id = Number(idStr);
    if (kind === undefined || !Number.isInteger(id)) return null;
    return [kind, id];
  };
  const src = parseRef(source);
  const dst = parseRef(target);
  if (src === null || dst === null) return [];
  let sql = 'SELECT * FROM edges WHERE src_kind=? AND src_id=? AND dst_kind=? AND dst_id=?';
  const args: Array<string | number> = [...src, ...dst];
  if (relation) {
    sql += ' AND relation_type=?';
    args.push(relation);
  }
  return (db.prepare(sql).all(...args) as DbEdgeRow[]).map((r) => ({
    from: label(db, r.src_kind, r.src_id),
    to: label(db, r.dst_kind, r.dst_id),
    relation: r.relation_type,
    method: r.method,
    confidence: r.confidence,
    anchor: r.anchor,
    raw: r.raw,
    source: sourceDoc(db, r.source_doc_id),
  }));
};

export const exportGraph = (vault: string, method?: string | null, minConf = 0.0): GraphExport => {
  const db = open(vault);
  const nodes: GraphExport['nodes'] = [];
  for (const r of db.prepare('SELECT * FROM documents').all() as DocRow[]) {
    nodes.push({
      id: `d:${r.id}`,
      label: r.title,
      kind: 'doc',
      type: 'doc',
      path: r.path,
      hash: r.hash,
    });
  }
  for (const r of db.prepare('SELECT * FROM entities').all() as EntityRow[]) {
    nodes.push({
      id: `e:${r.id}`,
      label: r.canonical,
      kind: 'entity',
      type: r.type,
      weight: r.mention_count,
    });
  }
  let sql = 'SELECT * FROM edges WHERE confidence >= ?';
  const args: Array<string | number> = [minConf];
  if (method) {
    sql += ' AND method = ?';
    args.push(method);
  }
  const edges: GraphExport['edges'] = [];
  for (const r of db.prepare(sql).all(...args) as DbEdgeRow[]) {
    edges.push({
      source: `${r.src_kind[0]}:${r.src_id}`,
      target: `${r.dst_kind[0]}:${r.dst_id}`,
      relation: r.relation_type,
      method: r.method,
      confidence: r.confidence,
    });
  }
  return { nodes, edges };
};
