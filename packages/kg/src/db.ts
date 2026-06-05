// SQLite graph index — a rebuildable view over the files in meta/kg/.
//
// Derived data: delete it and `kg db build` recreates it. Schema identical
// across runtimes (same cache path derivation), so index files are
// interchangeable.
//
// Runtime adapter: bun → bun:sqlite (node:sqlite is unavailable in Bun 1.2.x),
// node → node:sqlite. Both expose the same exec/prepare/run/get/all surface;
// the adapter only normalizes construction and `get()`'s no-row value
// (bun returns null, node returns undefined).

import { createHash } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

export type SqlValue = string | number | bigint | null
export type RunResult = { lastInsertRowid: number | bigint }
export type Stmt = {
  run(...args: SqlValue[]): RunResult
  get(...args: SqlValue[]): unknown
  all(...args: SqlValue[]): unknown[]
}
export type Db = {
  exec(sql: string): void
  prepare(sql: string): Stmt
  close(): void
}

type RawDbCtor = new (path: string) => Db

const loadCtor = async (): Promise<RawDbCtor> => {
  if (process.versions.bun !== undefined) {
    const mod = (await import('bun:sqlite')) as { Database: unknown }
    return mod.Database as RawDbCtor
  }
  const mod = await import('node:sqlite')
  return mod.DatabaseSync as unknown as RawDbCtor
}

const SqliteDatabase = await loadCtor()

export const SCHEMA_VERSION = '1'
export const CACHE_DIR = join(homedir(), '.cache', 'kg')

export const dbPathFor = (vault: string): string => {
  const digest = createHash('sha1').update(resolve(vault)).digest('hex').slice(0, 16)
  return join(CACHE_DIR, `${digest}.db`)
}

export const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);

CREATE TABLE documents (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL UNIQUE,
    path TEXT NOT NULL,
    title TEXT NOT NULL,
    top_section TEXT,
    tokenized TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_documents_hash ON documents(hash);

CREATE TABLE entities (
    id INTEGER PRIMARY KEY,
    cid TEXT NOT NULL UNIQUE,
    canonical TEXT NOT NULL,
    display TEXT NOT NULL,
    type TEXT NOT NULL,
    mention_count INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_entities_type ON entities(type);
CREATE INDEX idx_entities_canon ON entities(canonical);

CREATE TABLE edges (
    id INTEGER PRIMARY KEY,
    src_kind TEXT NOT NULL, src_id INTEGER NOT NULL,
    dst_kind TEXT NOT NULL, dst_id INTEGER NOT NULL,
    relation_type TEXT NOT NULL,
    source_doc_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    confidence REAL NOT NULL DEFAULT 1.0,
    method TEXT NOT NULL,
    anchor TEXT,
    raw TEXT
);
CREATE INDEX idx_edges_src ON edges(src_kind, src_id);
CREATE INDEX idx_edges_dst ON edges(dst_kind, dst_id);
CREATE INDEX idx_edges_rel ON edges(relation_type);

CREATE VIRTUAL TABLE documents_fts USING fts5(
    tokenized, content='documents', content_rowid='id', tokenize='unicode61');

CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
    INSERT INTO documents_fts(rowid, tokenized) VALUES (new.id, new.tokenized);
END;
CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, tokenized) VALUES('delete', old.id, old.tokenized);
END;
CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
    INSERT INTO documents_fts(documents_fts, rowid, tokenized) VALUES('delete', old.id, old.tokenized);
    INSERT INTO documents_fts(rowid, tokenized) VALUES (new.id, new.tokenized);
END;
`

type RawStmt = Stmt & { finalize?: () => void }

const wrapStmt = (raw: RawStmt): Stmt => ({
  run: (...args) => raw.run(...args),
  get: (...args) => raw.get(...args) ?? undefined, // bun returns null for no row
  all: (...args) => raw.all(...args),
})

export const connect = (dbPath: string): Db => {
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new SqliteDatabase(dbPath)
  db.exec('PRAGMA journal_mode=WAL')
  db.exec('PRAGMA foreign_keys=ON')
  db.exec('PRAGMA busy_timeout=5000')
  // bun:sqlite defers the real close while prepared statements are alive —
  // track them so close() can finalize first (node:sqlite has no finalize).
  const stmts: RawStmt[] = []
  return {
    exec: (sql) => db.exec(sql),
    prepare: (sql) => {
      const raw = db.prepare(sql) as RawStmt
      stmts.push(raw)
      return wrapStmt(raw)
    },
    close: () => {
      for (const s of stmts) s.finalize?.()
      stmts.length = 0
      db.close()
    },
  }
}

export const createSchema = (db: Db): void => {
  db.exec(SCHEMA)
  db.prepare("INSERT INTO meta(key, value) VALUES('schema_version', ?)").run(SCHEMA_VERSION)
}

export const schemaVersion = (db: Db): string | null => {
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key='schema_version'").get() as
      | { value: string }
      | undefined
    return row?.value ?? null
  } catch {
    return null
  }
}
