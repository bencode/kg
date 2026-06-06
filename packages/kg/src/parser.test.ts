import { expect, test } from 'vitest'
import { parse } from './parser.js'

test('wiki links parsed with containing line', () => {
  const text = '- worked on [[Dors系统]] today\n- also [[RAG]] and [[RAG]] again\n'
  const wl = parse(text, 'j/note.md').wikiLinks
  expect(wl.map((w) => w.name)).toEqual(['Dors系统', 'RAG', 'RAG'])
  expect(wl[0]!.line).toBe('- worked on [[Dors系统]] today')
})

test('wiki links inside fenced code blocks are ignored', () => {
  const text = 'before [[real]]\n```clojure\n[[1 2] [3 4]]\n```\nafter [[also-real]]\n'
  const names = parse(text, 'j/note.md').wikiLinks.map((w) => w.name)
  expect(names).toEqual(['real', 'also-real'])
})

test('empty wiki link names are dropped', () => {
  const names = parse('x [[  ]] y [[ok]]\n', 'j/n.md').wikiLinks.map((w) => w.name)
  expect(names).toEqual(['ok'])
})
