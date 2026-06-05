// Build the SQLite index from the files in meta/kg/ (always a full rebuild).
//
// The DB is disposable; this reconstructs it deterministically from registry +
// concepts + metadata. Unresolved concept references are skipped and counted.

import { existsSync, readdirSync, readFileSync, renameSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import * as conceptsMod from './concepts.js';
import type { Db } from './db.js';
import * as dbmod from './db.js';
import * as layout from './layout.js';
import { parse } from './parser.js';
import * as registry from './registry.js';
import { tokenizeForIndex } from './tokenize.js';
import type { MetadataRecord } from './types.js';

export type BuildResult = {
  db_path: string;
  documents: number;
  entities: number;
  edges: number;
  unresolved: number;
};

type EdgeRow = {
  sk: string;
  sid: number;
  dk: string;
  did: number;
  rel: string;
  sdoc: number;
  method: string;
  anchor: string | null;
  raw: string | null;
  conf: number;
};

const insertEdge = (db: Db, e: EdgeRow): void => {
  db.prepare(
    'INSERT INTO edges(src_kind,src_id,dst_kind,dst_id,relation_type,' +
      'source_doc_id,confidence,method,anchor,raw) VALUES(?,?,?,?,?,?,?,?,?,?)',
  ).run(e.sk, e.sid, e.dk, e.did, e.rel, e.sdoc, e.conf, e.method, e.anchor, e.raw);
};

export const build = (vaultRaw: string, dbPath?: string): BuildResult => {
  const vault = resolve(vaultRaw);
  const target = dbPath ?? dbmod.dbPathFor(vault);
  const working = `${target}.tmp`;
  for (const p of [working, `${working}-wal`, `${working}-shm`]) {
    if (existsSync(p)) unlinkSync(p);
  }

  const db = dbmod.connect(working);
  dbmod.createSchema(db);

  const docs = registry.load(vault);
  const hashToDocid = new Map<string, number>();
  const insDoc = db.prepare(
    'INSERT INTO documents(hash, path, title, top_section, tokenized) VALUES(?,?,?,?,?)',
  );
  for (const doc of docs.values()) {
    const text = readFileSync(join(vault, doc.path), 'utf-8');
    const top = doc.path.split('/')[0]!;
    const tok = tokenizeForIndex(`${parse(text, doc.path).title} ${text}`);
    const { lastInsertRowid } = insDoc.run(doc.hash, doc.path, doc.title, top, tok);
    hashToDocid.set(doc.hash, Number(lastInsertRowid));
  }

  const concepts = conceptsMod.load(vault);
  const nameToEntid = new Map<string, number>();
  const cidToEntid = new Map<string, number>();
  const insEnt = db.prepare('INSERT INTO entities(cid, canonical, display, type) VALUES(?,?,?,?)');
  for (const c of concepts) {
    const { lastInsertRowid } = insEnt.run(c.id, c.canonical, c.display, c.type);
    const eid = Number(lastInsertRowid);
    cidToEntid.set(c.id, eid);
    for (const key of new Set([c.id, c.canonical, ...c.aliases])) {
      nameToEntid.set(conceptsMod.norm(key), eid);
    }
  }

  const ent = (name: string): number | undefined =>
    cidToEntid.get(name) ?? nameToEntid.get(conceptsMod.norm(name));

  let edges = 0;
  let unresolved = 0;
  const mentionCount = new Map<number, number>();
  const mdir = layout.metadataDir(vault);
  if (existsSync(mdir)) {
    for (const name of readdirSync(mdir).sort()) {
      if (!name.endsWith('.json')) continue;
      const srcHash = name.slice(0, -'.json'.length);
      const srcDocid = hashToDocid.get(srcHash);
      if (srcDocid === undefined) continue;
      const rec = JSON.parse(readFileSync(join(mdir, name), 'utf-8')) as MetadataRecord;
      for (const m of rec.mentions ?? []) {
        const eid = ent(m.concept ?? '');
        if (eid === undefined) {
          unresolved += 1;
          continue;
        }
        insertEdge(db, {
          sk: 'doc',
          sid: srcDocid,
          dk: 'entity',
          did: eid,
          rel: 'mentions',
          sdoc: srcDocid,
          method: m.method ?? 'llm',
          anchor: m.anchor?.quote ?? null,
          raw: null,
          conf: 1.0,
        });
        mentionCount.set(eid, (mentionCount.get(eid) ?? 0) + 1);
        edges += 1;
      }
      for (const r of rec.relations ?? []) {
        const a = ent(r.from ?? '');
        const b = ent(r.to ?? '');
        if (a === undefined || b === undefined) {
          unresolved += 1;
          continue;
        }
        insertEdge(db, {
          sk: 'entity',
          sid: a,
          dk: 'entity',
          did: b,
          rel: r.relation ?? 'relates_to',
          sdoc: srcDocid,
          method: r.method ?? 'llm',
          anchor: r.anchor?.quote ?? null,
          raw: null,
          conf: r.confidence ?? 1.0,
        });
        edges += 1;
      }
      for (const dl of rec.doc_links ?? []) {
        const dst = hashToDocid.get(dl.to_hash ?? '');
        if (dst === undefined) {
          unresolved += 1;
          continue;
        }
        insertEdge(db, {
          sk: 'doc',
          sid: srcDocid,
          dk: 'doc',
          did: dst,
          rel: 'links_to',
          sdoc: srcDocid,
          method: dl.method ?? 'deterministic',
          anchor: null,
          raw: dl.raw ?? null,
          conf: 1.0,
        });
        edges += 1;
      }
    }
  }

  const updCount = db.prepare('UPDATE entities SET mention_count=? WHERE id=?');
  for (const [eid, n] of mentionCount) updCount.run(n, eid);
  // bun:sqlite's close() does not checkpoint WAL sidecars — flush everything
  // into the main file before we rename it, or the data stays stranded in
  // `<working>-wal` and the renamed db reads short.
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();

  for (const p of [`${working}-wal`, `${working}-shm`, target, `${target}-wal`, `${target}-shm`]) {
    if (existsSync(p)) unlinkSync(p);
  }
  renameSync(working, target);
  return {
    db_path: target,
    documents: hashToDocid.size,
    entities: cidToEntid.size,
    edges,
    unresolved,
  };
};
