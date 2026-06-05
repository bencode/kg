// metadata/<hash>.json — the L2 per-document layer.
//
// Every mention/relation carries a verbatim `anchor.quote` that must be a
// literal substring of that exact document version — the files-as-truth
// version of julia's anti-hallucination cite check.

import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import * as concepts from './concepts.js';
import * as layout from './layout.js';
import * as registry from './registry.js';
import type { DocLink, Mention, MetadataRecord, Relation } from './types.js';

export class ValidationError extends Error {
  problems: string[];
  constructor(problems: string[]) {
    super(problems.join('; '));
    this.problems = problems;
  }
}

/** Validate one metadata record against its source and the concept table. */
export const validateRecord = (
  vault: string,
  rec: MetadataRecord,
  sourceText: string,
): string[] => {
  const problems: string[] = [];
  const table = concepts.load(vault);
  const known = new Set(table.map((c) => c.id));
  const aliasIdx = concepts.aliasIndex(table);

  const checkConcept = (name: string, where: string): void => {
    if (known.has(name)) return;
    if (aliasIdx.has(concepts.norm(name))) return;
    problems.push(`${where}: unknown concept '${name}' (run \`kg concept import\` first)`);
  };

  const checkAnchor = (item: Mention | Relation, where: string): void => {
    const quote = item.anchor?.quote;
    if (!quote) {
      problems.push(`${where}: missing anchor.quote`);
      return;
    }
    if (!sourceText.includes(quote)) {
      problems.push(`${where}: anchor.quote not a verbatim substring of source`);
    }
  };

  (rec.mentions ?? []).forEach((m, i) => {
    checkConcept(m.concept ?? '', `mentions[${i}]`);
    checkAnchor(m, `mentions[${i}]`);
  });
  (rec.relations ?? []).forEach((r, i) => {
    checkConcept(r.from ?? '', `relations[${i}].from`);
    checkConcept(r.to ?? '', `relations[${i}].to`);
    checkAnchor(r, `relations[${i}]`);
  });
  // doc_links reference target docs by hash; quote is optional (structural).
  (rec.doc_links ?? []).forEach((dl, i) => {
    if (!dl.to_hash) problems.push(`doc_links[${i}]: missing to_hash`);
  });
  return problems;
};

type ImportResult = {
  hash: string;
  path: string;
  mentions: number;
  relations: number;
  doc_links: number;
};

/** Union mentions/relations/doc_links; scalar fields from new win if set. */
const merge = (old: MetadataRecord, fresh: MetadataRecord): MetadataRecord => {
  const out: MetadataRecord = { ...old };
  for (const [k, v] of Object.entries(fresh)) {
    if (k !== 'mentions' && k !== 'relations' && k !== 'doc_links' && v) {
      (out as Record<string, unknown>)[k] = v;
    }
  }
  const union = <T>(key: 'mentions' | 'relations' | 'doc_links', ident: (x: T) => string): void => {
    const olds = (old[key] ?? []) as T[];
    const news = (fresh[key] ?? []) as T[];
    const seen = new Set(olds.map(ident));
    const merged = [...olds];
    for (const x of news) {
      if (!seen.has(ident(x))) {
        merged.push(x);
        seen.add(ident(x));
      }
    }
    if (merged.length) (out as Record<string, unknown>)[key] = merged;
  };
  union<Mention>('mentions', (m) => JSON.stringify([m.concept, m.anchor?.quote]));
  union<Relation>('relations', (r) => JSON.stringify([r.from, r.relation, r.to]));
  union<DocLink>('doc_links', (d) => d.to_hash);
  return out;
};

const autocreateConcepts = (vault: string, rec: MetadataRecord): void => {
  const names = new Set<string>();
  for (const m of rec.mentions ?? []) if (m.concept) names.add(m.concept);
  for (const r of rec.relations ?? []) {
    if (r.from) names.add(r.from);
    if (r.to) names.add(r.to);
  }
  const existing = concepts.aliasIndex(concepts.load(vault));
  const fresh = [...names]
    .sort()
    .filter((n) => !existing.has(concepts.norm(n)))
    .map((n) => ({ canonical: n, display: n }));
  if (fresh.length) concepts.mergeImport(vault, fresh);
};

export type ImportOptions = { createMissing?: boolean; replace?: boolean };

/** Validate and write metadata/<hash>.json for one document (merge by default). */
export const importDoc = (
  vault: string,
  rec: MetadataRecord,
  { createMissing = false, replace = false }: ImportOptions = {},
): ImportResult => {
  const docHash = rec.hash;
  if (!docHash) throw new ValidationError(["record missing 'hash'"]);
  const doc = registry.resolve(vault, docHash);
  if (doc === undefined) {
    throw new ValidationError([`hash ${docHash} not in registry (run \`kg scan\` first)`]);
  }
  const sourceText = readFileSync(join(vault, doc.path), 'utf-8');

  if (createMissing) autocreateConcepts(vault, rec);

  const problems = validateRecord(vault, rec, sourceText);
  if (problems.length) throw new ValidationError(problems);

  layout.ensureKgDirs(vault);
  const out = layout.metadataPath(vault, docHash);
  let finalRec = rec;
  if (existsSync(out) && !replace) {
    finalRec = merge(JSON.parse(readFileSync(out, 'utf-8')) as MetadataRecord, rec);
  }
  const tmp = `${out}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(finalRec, null, 2)}\n`, 'utf-8');
  renameSync(tmp, out);
  return {
    hash: docHash,
    path: doc.path,
    mentions: (finalRec.mentions ?? []).length,
    relations: (finalRec.relations ?? []).length,
    doc_links: (finalRec.doc_links ?? []).length,
  };
};

export type ValidateAllResult = {
  checked: number;
  ok: number;
  failed: Array<{ hash: string; path: string; problems: string[] }>;
  orphans: string[];
};

/** Re-validate every metadata file against current sources and concepts. */
export const validateAll = (vault: string): ValidateAllResult => {
  const mdir = layout.metadataDir(vault);
  const live = registry.load(vault);
  const results: ValidateAllResult = { checked: 0, ok: 0, failed: [], orphans: [] };
  if (!existsSync(mdir)) return results;
  for (const name of readdirSync(mdir).sort()) {
    if (!name.endsWith('.json')) continue;
    const hash = name.slice(0, -'.json'.length);
    results.checked += 1;
    const doc = live.get(hash);
    if (doc === undefined) {
      results.orphans.push(hash);
      continue;
    }
    const sourceText = readFileSync(join(vault, doc.path), 'utf-8');
    const rec = JSON.parse(readFileSync(join(mdir, name), 'utf-8')) as MetadataRecord;
    const problems = validateRecord(vault, rec, sourceText);
    if (problems.length) results.failed.push({ hash, path: doc.path, problems });
    else results.ok += 1;
  }
  return results;
};
