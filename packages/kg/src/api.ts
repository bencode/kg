// Viewer-facing aggregations over registry/metadata/queries.
//
// Everything here is read-only. Documents are addressed by hash only — paths
// are resolved through the registry (whitelist) and double-checked to stay
// inside the vault, so no caller-supplied path ever touches the filesystem.

import { existsSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import * as conceptsMod from './concepts.js';
import * as layout from './layout.js';
import * as queries from './queries.js';
import * as registry from './registry.js';
import type { Concept, Doc, EntityAggregate, MetadataRecord } from './types.js';

export class DocNotFound extends Error {}

const absPathOf = (vault: string, docHash: string): { abs: string; doc: Doc } => {
  const doc = registry.resolve(vault, docHash);
  if (doc === undefined) throw new DocNotFound(docHash);
  const abs = resolve(join(vault, doc.path));
  const rel = relative(resolve(vault), abs);
  if (rel.startsWith('..') || rel.startsWith(sep)) {
    throw new DocNotFound(docHash); // registry poisoned or symlink escape
  }
  return { abs, doc };
};

export const rawText = (vault: string, docHash: string): string => {
  const { abs } = absPathOf(vault, docHash);
  return readFileSync(abs, 'utf-8');
};

export type DocInfo = {
  hash: string;
  path: string;
  title: string;
  abs_path: string;
  vscode_url: string;
  metadata: MetadataRecord | null;
};

/** Registry row + extracted metadata + editor link for the reading page. */
export const docInfo = (vault: string, docHash: string): DocInfo => {
  const { abs, doc } = absPathOf(vault, docHash);
  const metaPath = layout.metadataPath(vault, docHash);
  const meta = existsSync(metaPath)
    ? (JSON.parse(readFileSync(metaPath, 'utf-8')) as MetadataRecord)
    : null;
  return {
    hash: doc.hash,
    path: doc.path,
    title: doc.title,
    abs_path: abs,
    vscode_url: `vscode://file/${encodeURI(abs)}`,
    metadata: meta,
  };
};

export type LocateResult = { found: boolean; offset?: number; line?: number };

/** Find a verbatim quote in the source md → line/offset (1-based line). */
export const locate = (vault: string, docHash: string, quote: string): LocateResult => {
  const text = rawText(vault, docHash);
  const offset = text.indexOf(quote);
  if (offset < 0) return { found: false };
  const line = text.slice(0, offset).split('\n').length;
  return { found: true, offset, line };
};

export const conceptList = (vault: string, typeFilter?: string | null): Concept[] => {
  const cs = conceptsMod.load(vault);
  return typeFilter ? cs.filter((c) => c.type === typeFilter) : cs;
};

const nameHit = (name: string, q: string): boolean => {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ascii check
  if (/^[\x00-\x7f]+$/.test(name)) {
    // word-boundary match so the alias "PH" doesn't fire inside "graphrag"
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(q);
  }
  return q.includes(name);
};

/** Alias-dictionary entity spotting: longest concept names found in the text. */
const entitiesInQuestion = (vault: string, question: string, cap = 4): string[] => {
  const q = question.toLowerCase();
  const hits = new Map<string, number>();
  for (const c of conceptsMod.load(vault)) {
    for (const name of [c.canonical, c.display, ...c.aliases]) {
      const n = name.trim().toLowerCase();
      if (n.length >= 2 && nameHit(n, q)) {
        hits.set(c.canonical, Math.max(hits.get(c.canonical) ?? 0, n.length));
        break;
      }
    }
  }
  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, cap)
    .map(([name]) => name);
};

const searchSoft = (vault: string, q: string, limit: number): queries.SearchHit[] => {
  try {
    return queries.search(vault, q, limit);
  } catch (e) {
    if (e instanceof queries.IndexMissing || e instanceof queries.IndexStale) throw e;
    return []; // FTS match syntax can choke on odd tokens; QA degrades gracefully
  }
};

export type QaResult = {
  question: string;
  entities: Array<{ entity: EntityAggregate['entity']; top_edges: unknown[] }>;
  path: queries.PathStep[] | null;
  hits: queries.SearchHit[];
};

/**
 * Retrieval-only QA pack: FTS hits + spotted entities (+ path for a pair).
 * No generation — the caller (a human, or an agent) synthesizes the answer;
 * every item carries enough identity (hash/anchor) to cite back.
 */
export const qa = (vault: string, question: string, limit = 8): QaResult => {
  const names = entitiesInQuestion(vault, question);
  const entities: QaResult['entities'] = [];
  for (const name of names) {
    const e = queries.entity(vault, name);
    if (e === null) continue;
    const edges = [...e.out_edges, ...e.in_edges].sort((a, b) => {
      const da = a.method === 'deterministic' ? 0 : 1;
      const db = b.method === 'deterministic' ? 0 : 1;
      if (da !== db) return da - db;
      return (b.confidence ?? 0) - (a.confidence ?? 0);
    });
    entities.push({ entity: e.entity, top_edges: edges.slice(0, 8) });
  }
  const pathChain = names.length >= 2 ? queries.paths(vault, names[0]!, names[1]!) : null;
  let hits = searchSoft(vault, question, limit);
  if (!hits.length && names.length) {
    // full question AND-matched nothing — fall back to the spotted entities
    for (const name of names) {
      const seen = new Set(hits.map((h) => h.path));
      hits.push(...searchSoft(vault, name, limit).filter((h) => !seen.has(h.path)));
    }
    hits = hits.slice(0, limit);
  }
  return { question, entities, path: pathChain, hits };
};
