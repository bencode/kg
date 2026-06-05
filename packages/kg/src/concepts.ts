// concepts.json — the L1 concept entity table (controlled vocabulary).
//
// Append-only in spirit: `mergeImport` merges by canonical name, unions
// aliases, and keeps the higher-priority type — it never drops existing
// concepts.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import * as layout from './layout.js';
import type { Concept } from './types.js';

// higher index = higher priority when two imports disagree on a concept's type
export const TYPE_PRIORITY = [
  'section',
  'doc',
  'concept',
  'framework',
  'method',
  'person',
  'paper',
];

export type ConceptInput = Partial<Concept> & { canonical?: string };

export const norm = (s: string): string => s.trim().toLowerCase().split(/\s+/).join(' ');

export const slugify = (name: string): string => {
  const slug = [...norm(name)]
    .map((ch) => (/[\p{L}\p{N}]/u.test(ch) ? ch : '-'))
    .join('')
    .split('-')
    .filter(Boolean)
    .join('-');
  return slug || 'concept';
};

export const load = (vault: string): Concept[] => {
  const path = layout.conceptsPath(vault);
  if (!existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<
    Partial<Concept> & { id: string; canonical: string }
  >;
  return raw.map((c) => ({
    id: c.id,
    canonical: c.canonical,
    display: c.display ?? c.canonical,
    type: c.type ?? 'concept',
    aliases: c.aliases ?? [],
    summary: c.summary ?? '',
  }));
};

export const save = (vault: string, concepts: Concept[]): void => {
  layout.ensureKgDirs(vault);
  const path = layout.conceptsPath(vault);
  const data = [...concepts].sort((a, b) => (a.id < b.id ? -1 : 1));
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf-8');
  renameSync(tmp, path);
};

/** Map normalized canonical/alias/id → concept id. */
export const aliasIndex = (concepts: Concept[]): Map<string, string> => {
  const idx = new Map<string, string>();
  for (const c of concepts) {
    idx.set(norm(c.canonical), c.id);
    idx.set(norm(c.id), c.id);
    for (const a of c.aliases) {
      if (!idx.has(norm(a))) idx.set(norm(a), c.id);
    }
  }
  return idx;
};

export const resolve = (vault: string, name: string): Concept | undefined => {
  const concepts = load(vault);
  const cid = aliasIndex(concepts).get(norm(name));
  if (cid === undefined) return undefined;
  return concepts.find((c) => c.id === cid);
};

const betterType = (a: string, b: string): string => {
  const pa = TYPE_PRIORITY.indexOf(a);
  const pb = TYPE_PRIORITY.indexOf(b);
  return pa >= pb ? a : b;
};

export type MergeResult = { added: number; updated: number; total: number };

/** Merge incoming concept records into concepts.json. Returns counts. */
export const mergeImport = (vault: string, incoming: ConceptInput[]): MergeResult => {
  const concepts = load(vault);
  const byId = new Map(concepts.map((c) => [c.id, c]));
  const canonIdx = aliasIndex(concepts);
  let added = 0;
  let updated = 0;

  for (const rec of incoming) {
    const canonical = rec.canonical || rec.display || rec.id;
    if (!canonical) continue;
    const rtype = rec.type ?? 'concept';
    let aliases = rec.aliases ?? [];
    const display = rec.display ?? canonical;
    const summary = rec.summary ?? '';

    // Resolve to an existing concept by id, canonical, OR any alias collision
    // (so a titled paper merges into its bare `arxiv:...` stub and vice versa).
    let cid = rec.id || canonIdx.get(norm(canonical));
    if (cid === undefined) {
      for (const a of aliases) {
        const hit = canonIdx.get(norm(a));
        if (hit !== undefined) {
          cid = hit;
          break;
        }
      }
    }
    cid = cid || slugify(canonical);

    let existing = byId.get(cid);
    if (existing === undefined) {
      existing = concepts.find((c) => norm(c.canonical) === norm(canonical));
    }
    if (existing === undefined) {
      const c: Concept = {
        id: cid,
        canonical,
        display,
        type: rtype,
        aliases: [...new Set(aliases)].sort(),
        summary,
      };
      concepts.push(c);
      byId.set(c.id, c);
      canonIdx.set(norm(c.canonical), c.id);
      added += 1;
    } else {
      // If the existing canonical is a bare "arxiv:..." stub and the incoming
      // one is a real title, upgrade to the better name and demote the stub
      // to an alias.
      if (
        existing.canonical.toLowerCase().startsWith('arxiv:') &&
        !canonical.toLowerCase().startsWith('arxiv:')
      ) {
        aliases = [...aliases, existing.canonical];
        existing.canonical = canonical;
        existing.display = display;
      }
      existing.aliases = [...new Set([...existing.aliases, ...aliases])].sort();
      existing.type = betterType(existing.type, rtype);
      if (summary && !existing.summary) existing.summary = summary;
      updated += 1;
    }
  }

  save(vault, concepts);
  return { added, updated, total: concepts.length };
};
