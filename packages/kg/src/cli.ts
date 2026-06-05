#!/usr/bin/env node
// kg CLI — same commands, JSON output, and exit codes as the original
// Python implementation: 0 ok, 1 usage/IO error, 2 validation error,
// 3 index missing, 4 index stale.

import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { parseArgs } from 'node:util'
import type { ConceptInput } from './concepts.js'
import * as concepts from './concepts.js'
import * as extractStructural from './extract-structural.js'
import * as layout from './layout.js'
import * as metadata from './metadata.js'
import { parse } from './parser.js'
import * as registry from './registry.js'
import type { MetadataRecord } from './types.js'

const emit = (obj: unknown): number => {
  process.stdout.write(`${JSON.stringify(obj, null, 2)}\n`)
  return 0
}

const err = (msg: string, code = 1): number => {
  process.stderr.write(`kg: ${msg}\n`)
  return code
}

const readJsonArg = (src: string): unknown =>
  JSON.parse(src === '-' ? readFileSync(0, 'utf-8') : readFileSync(src, 'utf-8'))

type Cmd = (
  positionals: string[],
  values: Record<string, string | boolean | undefined>,
) => Promise<number> | number

const opt = (v: string | boolean | undefined, fallback: string): string =>
  typeof v === 'string' ? v : fallback

const vaultOf = (raw: string | undefined): string => {
  if (!raw) throw new layout.VaultError('missing vault argument')
  return layout.resolveVault(raw)
}

const query = async (fn: () => unknown): Promise<number> => {
  const { IndexMissing, IndexStale } = await import('./queries.js')
  try {
    return emit(fn())
  } catch (e) {
    if (e instanceof IndexMissing) return err(e.message, 3)
    if (e instanceof IndexStale) return err(e.message, 4)
    throw e
  }
}

const conceptCmds: Record<string, Cmd> = {
  list: ([vault], v) => {
    const cs = concepts.load(vaultOf(vault))
    const type = typeof v.type === 'string' ? v.type : null
    return emit(type ? cs.filter((c) => c.type === type) : cs)
  },
  import: ([vault, json]) => {
    const data = readJsonArg(json ?? '-')
    const records = (Array.isArray(data) ? data : [data]) as ConceptInput[]
    return emit(concepts.mergeImport(vaultOf(vault), records))
  },
  resolve: ([name, vault]) => {
    const c = concepts.resolve(vaultOf(vault), name ?? '')
    return c === undefined ? err(`no concept for: ${name}`) : emit(c)
  },
  prep: ([vault], v) => {
    const root = vaultOf(vault)
    const scope = opt(v.scope, 'all')
    const prefixes =
      scope === 'all'
        ? null
        : scope
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
    const out = [...registry.load(root).values()]
      .sort((a, b) => (a.path < b.path ? -1 : 1))
      .filter(
        (d) =>
          prefixes === null || prefixes.some((p) => d.path === p || d.path.startsWith(`${p}/`)),
      )
      .map((d) => {
        const pd = parse(readFileSync(`${root}/${d.path}`, 'utf-8'), d.path)
        return {
          hash: d.hash,
          path: d.path,
          title: pd.title,
          headings: pd.headings.map(([, h]) => h),
        }
      })
    return emit(out)
  },
}

const metadataCmds: Record<string, Cmd> = {
  import: ([vault, json], v) => {
    const root = vaultOf(vault)
    const data = readJsonArg(json ?? '-')
    const records = (Array.isArray(data) ? data : [data]) as MetadataRecord[]
    const results: unknown[] = []
    const rejected: unknown[] = []
    for (const rec of records) {
      try {
        results.push(
          metadata.importDoc(root, rec, {
            createMissing: v['create-missing'] === true,
            replace: v.replace === true,
          }),
        )
      } catch (e) {
        if (e instanceof metadata.ValidationError) {
          rejected.push({ hash: rec.hash, problems: e.problems })
        } else throw e
      }
    }
    emit({ imported: results, rejected })
    return rejected.length ? 2 : 0
  },
  validate: ([vault]) => {
    const res = metadata.validateAll(vaultOf(vault))
    emit(res)
    return res.failed.length || res.orphans.length ? 2 : 0
  },
}

const sub =
  (table: Record<string, Cmd>): Cmd =>
  (positionals, values) => {
    const [name, ...rest] = positionals
    const cmd = name !== undefined ? table[name] : undefined
    if (cmd === undefined) return err(`unknown subcommand: ${name}`)
    return cmd(rest, values)
  }

const commands: Record<string, Cmd> = {
  scan: ([vault], v) => emit(registry.scan(vaultOf(vault), opt(v.scope, 'all'))),
  resolve: ([hash, vault]) => {
    const doc = registry.resolve(vaultOf(vault), hash ?? '')
    if (doc === undefined) return err(`hash not in registry: ${hash}`)
    return emit({ hash: doc.hash, path: doc.path, title: doc.title })
  },
  pending: ([vault], v) => {
    const limit = typeof v.limit === 'string' ? Number(v.limit) : undefined
    return emit(
      registry
        .pending(vaultOf(vault), limit)
        .map((d) => ({ hash: d.hash, path: d.path, title: d.title })),
    )
  },
  gc: ([vault]) => emit(registry.gc(vaultOf(vault))),
  concept: sub(conceptCmds),
  metadata: sub(metadataCmds),
  'extract-structural': ([vault, path], v) => {
    const root = vaultOf(vault)
    const rec = extractStructural.extract(root, path ?? '')
    if (v.write === true) {
      concepts.mergeImport(root, extractStructural.arxivConcepts(rec))
      try {
        return emit(metadata.importDoc(root, rec, { createMissing: true }))
      } catch (e) {
        if (e instanceof metadata.ValidationError) return err(e.problems.join('; '), 2)
        throw e
      }
    }
    return emit(rec)
  },
  doc: ([file]) => {
    const text = readFileSync(file ?? '', 'utf-8')
    const pd = parse(text, file ?? '')
    return emit({
      hash: layout.hashBytes(Buffer.from(text, 'utf-8')),
      title: pd.title,
      headings: pd.headings.length,
      links: pd.links.map((l) => l.targetRel),
      arxiv: extractStructural.findArxivIds(text).map(([id]) => id),
    })
  },
  db: async (positionals, values) => {
    const [name, vault] = positionals
    if (name === 'build') {
      const { build } = await import('./dbbuild.js')
      return emit(build(vaultOf(vault)))
    }
    if (name === 'stats') {
      const { stats } = await import('./queries.js')
      return query(() => stats(vaultOf(vault)))
    }
    void values
    return err(`unknown subcommand: ${name}`)
  },
  search: async ([q, vault], v) => {
    const { search } = await import('./queries.js')
    return query(() => search(vaultOf(vault), q ?? '', Number(opt(v.limit, '20'))))
  },
  entity: async ([name, vault]) => {
    const { entity } = await import('./queries.js')
    return query(() => {
      const res = entity(vaultOf(vault), name ?? '')
      if (res === null) throw new layout.VaultError(`not found: ${name}`)
      return res
    })
  },
  neighbors: async ([name, vault], v) => {
    const { neighbors } = await import('./queries.js')
    return query(() => neighbors(vaultOf(vault), name ?? '', Number(opt(v.depth, '1'))))
  },
  paths: async ([a, b, vault], v) => {
    const { paths } = await import('./queries.js')
    return query(() => paths(vaultOf(vault), a ?? '', b ?? '', Number(opt(v['max-hops'], '4'))))
  },
  export: async ([vault], v) => {
    const { exportGraph } = await import('./queries.js')
    const method = typeof v.method === 'string' ? v.method : null
    return query(() => exportGraph(vaultOf(vault), method, Number(opt(v['min-conf'], '0'))))
  },
  qa: async ([question, vault], v) => {
    const { qa } = await import('./api.js')
    return query(() => qa(vaultOf(vault), question ?? '', Number(opt(v.limit, '8'))))
  },
  locate: async ([hash, quote, vault]) => {
    const { locate, DocNotFound } = await import('./api.js')
    try {
      return emit(locate(vaultOf(vault), hash ?? '', quote ?? ''))
    } catch (e) {
      if (e instanceof DocNotFound) return err(`hash not in registry: ${e.message}`)
      throw e
    }
  },
  'doc-info': async ([hash, vault]) => {
    const { docInfo, DocNotFound } = await import('./api.js')
    try {
      return emit(docInfo(vaultOf(vault), hash ?? ''))
    } catch (e) {
      if (e instanceof DocNotFound) return err(`hash not in registry: ${e.message}`)
      throw e
    }
  },
  serve: async ([vault], v) => {
    const { serve } = await import('./server.js')
    serve(vaultOf(vault), Number(opt(v.port, '8765')))
    return 0
  },
}

export const main = async (argv: string[]): Promise<number> => {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      scope: { type: 'string' },
      limit: { type: 'string' },
      type: { type: 'string' },
      depth: { type: 'string' },
      'max-hops': { type: 'string' },
      method: { type: 'string' },
      'min-conf': { type: 'string' },
      port: { type: 'string' },
      write: { type: 'boolean' },
      'create-missing': { type: 'boolean' },
      replace: { type: 'boolean' },
    },
  })
  const [name, ...rest] = positionals
  const cmd = name !== undefined ? commands[name] : undefined
  if (cmd === undefined) {
    return err(`unknown command: ${name ?? '(none)'}; commands: ${Object.keys(commands).join(' ')}`)
  }
  try {
    return await cmd(rest, values)
  } catch (e) {
    if (e instanceof layout.VaultError) return err(e.message)
    if (e instanceof SyntaxError) return err(`invalid json: ${e.message}`)
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return err(String(e))
    throw e
  }
}

const argv1 = process.argv[1]
if (argv1 !== undefined && import.meta.url === pathToFileURL(argv1).href) {
  main(process.argv.slice(2)).then((code) => {
    if (code !== 0) process.exitCode = code
  })
}
