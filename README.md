# kg

Knowledge graph over a markdown vault. **Files are the truth** — the graph
lives in plain JSON under `<vault>/meta/kg/` (a hash↔path registry, an L1
concept table, and per-document L2 metadata with verbatim source anchors).
The SQLite index and the local viewer are rebuildable layers on top.

```
<vault>/meta/kg/registry.jsonl       # {hash, path, title, mtime, size} per doc
<vault>/meta/kg/concepts.json        # L1 concept table (controlled vocabulary)
<vault>/meta/kg/metadata/<hash>.json # L2 mentions/relations, named by content hash
~/.cache/kg/<sha1(vault)>.db         # derived SQLite index — delete freely
```

Key properties:

- **Hash-as-identity**: docs are referenced by content sha256, never by path.
  Renames only rewrite the registry; content edits orphan the old metadata
  (surfaced by `kg pending` / `kg gc`) so each doc version is extracted once.
- **Anti-hallucination anchors**: every mention/relation carries a verbatim
  `anchor.quote` validated as a literal substring of the source on import.
- **Two trust tiers**: `deterministic` edges (md links, arXiv ids) vs `llm`
  edges (extracted, with confidence).

## Install

Three ways, easiest first:

1. **Single-file binary** (no runtime needed at all):
   ```bash
   pnpm install && pnpm -C packages/kg compile   # → dist-bin/kg (~60MB)
   ./dist-bin/kg db stats <vault>
   ```
   Ship that one file to users — sqlite, jieba dict, and the viewer UI are all
   embedded.
2. **Bun** (runs TypeScript directly, no build step):
   ```bash
   bun packages/kg/src/cli.ts <command> ...
   ```
3. **Node ≥ 22.5** (npm ecosystem; on 22.x add `--experimental-sqlite`):
   ```bash
   pnpm install && pnpm build      # tsc → packages/kg/dist
   node packages/kg/dist/cli.js <command> ...
   ```

The sqlite layer auto-selects `bun:sqlite` or `node:sqlite` at runtime; index
files are interchangeable between the two.

Dev: `pnpm test` (vitest, node path) and `pnpm -C packages/kg test:bun`
(bun path) run the same suite. After editing `packages/kg/viewer/`, run
`pnpm -C packages/kg embed` to refresh the binary-embedded copies.

## CLI

```bash
KG="bun packages/kg/src/cli.ts"   # or node packages/kg/dist/cli.js, or dist-bin/kg

# Phase 1 — pure files
$KG scan <vault> [--scope knowledge]      # hash ledger: new/changed/deleted
$KG pending <vault>                       # docs awaiting extraction
$KG concept import <vault> <json|->      # merge L1 concepts (alias-dedup)
$KG metadata import <vault> <json|->     # validate anchors + write L2
$KG extract-structural <vault> <path> --write   # deterministic links/arXiv

# Phase 2 — SQLite graph index (rebuildable)
$KG db build <vault>
$KG search "<query>" <vault>              # jieba-tokenized FTS5
$KG entity <name> <vault>                 # edges + anchors + source docs
$KG neighbors <name> <vault> --depth 2
$KG paths <a> <b> <vault>
$KG export <vault> --method deterministic

# Agent QA (no server needed)
$KG qa "<question>" <vault>               # entities + shortest path + FTS hits
$KG locate <hash> "<quote>" <vault>       # quote → line number
$KG doc-info <hash> <vault>               # hash → path + metadata + editor url

# Phase 3 — local viewer (127.0.0.1 only)
$KG serve <vault> --port 8765
```

All commands print JSON. Exit codes: 0 ok · 1 usage/IO · 2 validation ·
3 index missing · 4 index stale.

## Viewer

`kg serve` is one process serving both the static UI and the JSON API
(same-origin fetch, no CORS). Pages: home / entity hub / document reading view
with `?cite=` quote highlighting / graph (ego focus + skeleton overview).
North star: every claim links back to its verbatim source line.

A future React viewer will live in `web/` and build into `packages/kg/viewer/`
— the server contract doesn't change.

## Claude Code plugin

This repo doubles as a Claude Code plugin (`.claude-plugin/plugin.json` +
`skills/kg/SKILL.md`). The skill teaches the agent the extraction contract:
the LLM reads documents and emits metadata JSON; the CLI only does
deterministic file IO and anchor validation.
