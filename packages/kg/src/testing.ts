// Test fixture: a minimal markdown vault under a tmp dir (mirrors Python conftest).

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const makeVault = (): string => {
  const vault = mkdtempSync(join(tmpdir(), 'kg-test-'))
  const k = join(vault, 'knowledge')
  mkdirSync(k)
  writeFileSync(
    join(k, 'a.md'),
    '# Doc A\n\nDiscusses RAG and links to [B](./b.md).\n' +
      'See arXiv:2605.18747v1 and the bogus 0324.1227.\n',
    'utf-8',
  )
  writeFileSync(join(k, 'b.md'), '# Doc B\n\nAbout retrieval.\n', 'utf-8')
  return vault
}

export const removeVault = (vault: string): void => {
  rmSync(vault, { recursive: true, force: true })
}
