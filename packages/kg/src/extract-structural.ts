// Deterministic structural pre-fill: relative md links + arXiv ids.
//
// Produces a metadata record (same schema as the LLM L2 layer, method=
// "deterministic"). arXiv detection is guarded against date-like false
// positives (the month segment must be 01-12).

import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { ConceptInput } from './concepts.js';
import * as layout from './layout.js';
import { parse } from './parser.js';
import * as registry from './registry.js';
import type { MetadataRecord } from './types.js';

// arXiv new-scheme id: YYMM.NNNNN[vN]. The MM (month) segment 01-12 is the key
// discriminator that rejects e.g. 0324.1227 (month 24), 1213.1925 (month 13).
const ARXIV = /(?<!\d)(\d{2})(\d{2})\.(\d{4,5})(v\d+)?(?!\d)/g;

const validArxiv = (mm: string): boolean => {
  const month = Number(mm);
  return month >= 1 && month <= 12;
};

/** Return [arxivId, lineText] pairs for valid arxiv references. */
export const findArxivIds = (text: string): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const line of text.split('\n')) {
    for (const m of line.matchAll(ARXIV)) {
      const [, yy, mm, num, ver] = m;
      if (!validArxiv(mm!)) continue;
      out.push([`${yy}${mm}.${num}${ver ?? ''}`, line.trim()]);
    }
  }
  return out;
};

/** Resolve a link relative to the linking file's dir → vault-relative path. */
const resolveLinkTarget = (vault: string, fromRel: string, targetRel: string): string | null => {
  const base = dirname(join(vault, fromRel));
  const targetAbs = resolve(base, targetRel);
  const rel = relative(vault, targetAbs);
  if (rel.startsWith('..') || rel.startsWith(sep)) return null;
  return rel.split(sep).join('/');
};

/** Build a deterministic metadata record for one document. */
export const extract = (vault: string, relPath: string): MetadataRecord => {
  const text = readFileSync(join(vault, relPath), 'utf-8');
  const docHash = layout.hashBytes(Buffer.from(text, 'utf-8'));
  const byPath = registry.loadByPath(vault);
  const doc = parse(text, relPath);

  const docLinks: NonNullable<MetadataRecord['doc_links']> = [];
  const dangling: string[] = [];
  for (const link of doc.links) {
    const targetPath = resolveLinkTarget(vault, relPath, link.targetRel);
    const target = targetPath !== null ? byPath.get(targetPath) : undefined;
    if (target !== undefined) {
      docLinks.push({
        to_hash: target.hash,
        to_path: targetPath!,
        raw: link.raw,
        method: 'deterministic',
      });
    } else {
      dangling.push(link.raw);
    }
  }

  const mentions: NonNullable<MetadataRecord['mentions']> = [];
  for (const [arxivId, line] of findArxivIds(text)) {
    mentions.push({
      concept: `arxiv:${arxivId}`,
      anchor: { quote: line },
      method: 'deterministic',
    });
  }

  const rec: MetadataRecord = { hash: docHash, path: relPath, doc_links: docLinks, mentions };
  if (dangling.length) rec._dangling = dangling;
  return rec;
};

/** Concept records for the arxiv ids referenced in a structural record. */
export const arxivConcepts = (rec: MetadataRecord): ConceptInput[] => {
  const out: ConceptInput[] = [];
  for (const m of rec.mentions ?? []) {
    const c = m.concept ?? '';
    if (c.startsWith('arxiv:')) {
      out.push({ id: c, canonical: c, display: c, type: 'paper', aliases: [c.split(':')[1]!] });
    }
  }
  return out;
};
