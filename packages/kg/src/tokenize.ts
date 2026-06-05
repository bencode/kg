// Jieba-based tokenization for FTS5 indexing.
//
// FTS5's built-in unicode61 tokenizer is naive for CJK — it treats each
// codepoint as a token, so `学生` spuriously matches `数学生活`. Jieba knows
// word boundaries. Trick: store jieba-tokenized space-separated words in a
// shadow column and let unicode61 index that; tokenize queries the same way.

import { Jieba } from '@node-rs/jieba';
import { dict } from '@node-rs/jieba/dict.js';

const jieba = Jieba.withDict(dict);

/**
 * Tokenize content for FTS5 storage (search-mode cut: emits compound words AND
 * their sub-words, e.g. `物理课` → `物理 物理课`).
 */
export const tokenizeForIndex = (text: string): string => {
  if (!text) return '';
  return jieba
    .cutForSearch(text)
    .map((t) => t.trim())
    .filter(Boolean)
    .join(' ');
};

const hasFtsOperators = (q: string): boolean => {
  if (q.includes('"') || q.includes('(')) return true;
  return [' AND ', ' OR ', ' NOT ', ' NEAR '].some((op) => q.includes(op));
};

/** Re-tokenize phrases inside `"..."` but leave operators alone. */
const tokenizeAdvanced = (query: string): string => {
  const quoteCount = (query.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) {
    // Unmatched quote — strip and treat as plain text rather than emit
    // malformed FTS5 syntax.
    return tokenizeForIndex(query.replaceAll('"', ''));
  }
  const out: string[] = [];
  let i = 0;
  while (i < query.length) {
    if (query[i] === '"') {
      const j = query.indexOf('"', i + 1);
      out.push(`"${tokenizeForIndex(query.slice(i + 1, j))}"`);
      i = j + 1;
    } else {
      out.push(query[i]!);
      i += 1;
    }
  }
  return out.join('');
};

/** Tokenize a user query the same way as the index; preserve FTS5 operators. */
export const tokenizeQuery = (query: string): string => {
  if (!query.trim()) return '';
  if (hasFtsOperators(query)) return tokenizeAdvanced(query);
  return tokenizeForIndex(query);
};
