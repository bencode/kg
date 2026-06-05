import { afterEach, beforeEach, expect, test } from 'vitest';
import * as concepts from './concepts.js';
import { makeVault, removeVault } from './testing.js';

let vault: string;
beforeEach(() => {
  vault = makeVault();
});
afterEach(() => {
  removeVault(vault);
});

test('import dedups and unions aliases', () => {
  concepts.mergeImport(vault, [{ canonical: 'RAG', aliases: ['检索增强生成'], summary: 's' }]);
  concepts.mergeImport(vault, [{ canonical: 'RAG', aliases: ['retrieval-augmented generation'] }]);
  const cs = concepts.load(vault);
  expect(cs).toHaveLength(1);
  expect(new Set(cs[0]!.aliases)).toEqual(
    new Set(['检索增强生成', 'retrieval-augmented generation']),
  );
  expect(cs[0]!.summary).toBe('s'); // not clobbered by the second import
});

test('resolve by alias / canonical case-insensitively', () => {
  concepts.mergeImport(vault, [{ canonical: 'RAG', aliases: ['检索增强生成'] }]);
  expect(concepts.resolve(vault, '检索增强生成')?.canonical).toBe('RAG');
  expect(concepts.resolve(vault, 'rag')?.canonical).toBe('RAG');
  expect(concepts.resolve(vault, 'nope')).toBeUndefined();
});

test('type priority kept', () => {
  concepts.mergeImport(vault, [{ canonical: 'SkillOpt', type: 'concept' }]);
  concepts.mergeImport(vault, [{ canonical: 'SkillOpt', type: 'paper' }]);
  expect(concepts.resolve(vault, 'SkillOpt')?.type).toBe('paper');
});

test('alias collision merges arxiv stub and upgrades canonical', () => {
  concepts.mergeImport(vault, [{ canonical: 'arxiv:1706.03762v7', type: 'paper' }]);
  concepts.mergeImport(vault, [
    { canonical: 'Attention Is All You Need', type: 'paper', aliases: ['arxiv:1706.03762v7'] },
  ]);
  const papers = concepts.load(vault).filter((c) => c.type === 'paper');
  expect(papers).toHaveLength(1);
  expect(papers[0]!.canonical).toBe('Attention Is All You Need');
  expect(papers[0]!.aliases).toContain('arxiv:1706.03762v7');
  expect(concepts.resolve(vault, 'arxiv:1706.03762v7')?.canonical).toBe(
    'Attention Is All You Need',
  );
});
