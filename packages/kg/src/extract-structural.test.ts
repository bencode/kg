import { afterEach, beforeEach, expect, test } from 'vitest';
import * as ex from './extract-structural.js';
import * as registry from './registry.js';
import { makeVault, removeVault } from './testing.js';

let vault: string;
beforeEach(() => {
  vault = makeVault();
});
afterEach(() => {
  removeVault(vault);
});

test('arxiv guard rejects date-like ids', () => {
  const text = 'real 2605.18747v1 2305.16291 ; fake 0324.1227 0365.25006 1213.1925';
  const ids = ex.findArxivIds(text).map(([id]) => id);
  expect(ids).toContain('2605.18747v1');
  expect(ids).toContain('2305.16291');
  expect(ids).not.toContain('0324.1227'); // month 24
  expect(ids).not.toContain('0365.25006'); // month 65
  expect(ids).not.toContain('1213.1925'); // month 13
});

test('links resolve to target hash', () => {
  registry.scan(vault, 'knowledge');
  const rec = ex.extract(vault, 'knowledge/a.md');
  expect(rec.doc_links).toHaveLength(1);
  const bHash = registry.loadByPath(vault).get('knowledge/b.md')!.hash;
  expect(rec.doc_links![0]!.to_hash).toBe(bHash);
});

test('structural emits arxiv mentions with month guard', () => {
  registry.scan(vault, 'knowledge');
  const rec = ex.extract(vault, 'knowledge/a.md');
  const named = new Set((rec.mentions ?? []).map((m) => m.concept));
  expect(named).toContain('arxiv:2605.18747v1');
  expect([...named].every((c) => !c.startsWith('arxiv:0324'))).toBe(true);
});
