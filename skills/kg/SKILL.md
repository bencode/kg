---
name: kg
description: Build and query a knowledge graph over a markdown vault (e.g. brain2). Files-as-truth — the graph lives in plain JSON under <vault>/meta/kg/ (registry of hash↔path, a concept table, and per-document metadata), so it's diffable, hand-editable, and git-committable; the SQLite index and viewer are rebuildable layers on top. Trigger when the user says "知识图谱 / knowledge graph / 建图谱 / 抽实体关系 / 这篇笔记关联了什么 / X 和 Y 有什么关系 / 哪些论文属于 X / kg", or wants to extract entities & relations from their notes. Extraction is layered: L1 a concept table (controlled vocabulary), L2 per-document mentions/relations carrying verbatim source anchors. The LLM (you) reads files and emits metadata JSON; the CLI only does deterministic file IO + anchor validation.
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# kg

A CLI for extracting a knowledge graph from a markdown vault, and the contracts
for how you (Claude) drive the LLM extraction. **Core principle: files are the
truth.** Everything authoritative is plain text under `<vault>/meta/kg/`:

```
meta/kg/registry.jsonl      # one line per doc: {hash, path, title, mtime, size}
meta/kg/concepts.json       # L1 concept table (controlled vocabulary)
meta/kg/metadata/<hash>.json# L2 per-document mentions/relations (named by content hash)
```

A document's identity is the sha256 of its bytes. Anchors and edges reference
docs by **hash, never path** — moving/renaming a file only rewrites the
registry; changing a file's content makes a new hash (old metadata becomes an
orphan to re-extract). SQLite (Phase 2) and a viewer (Phase 3) are rebuildable
from these files and may be deleted freely.

## CLI invocation

`kg` runs on Bun (preferred — executes TS directly, no build step) or
Node ≥22.5. From a plugin install, `${CLAUDE_PLUGIN_ROOT}` is the repo root:

```bash
bun ${CLAUDE_PLUGIN_ROOT}/packages/kg/src/cli.ts <command> ...
# fallbacks: node ${CLAUDE_PLUGIN_ROOT}/packages/kg/dist/cli.js (after pnpm build)
#            a compiled single-file binary `kg` if one is on PATH
```

Run `pnpm install` once in the repo if node_modules is missing. Use an
absolute path in Bash; the binary is not on global PATH.

All commands print JSON to stdout. Exit codes: `0` ok, `1` usage/IO error,
`2` validation error.

## 1. Find the vault

The vault is the markdown repo root (for brain2, the dir containing
`knowledge/`). Confirm it with the user's working dirs; remember it for the
conversation — don't re-detect each call.

## 2. Keep the registry fresh (always first)

Before any extraction or query, scan so the hash ledger matches disk:

```bash
kg scan <vault> [--scope all|knowledge|knowledge,curriculum]
```

Reports `new/changed/unchanged/deleted`. Incremental and cheap. A scoped scan
never drops out-of-scope docs already in the registry.

**Scope resolution:** explicit `--scope` > `meta/kg/config.json` `scope` array >
`all`. A vault that defines `scope` in its config is safe to scan bare
(`kg scan <vault>`); **never pass `--scope all` to a configured vault** unless
the user asks — it pulls operational noise (configs, machine imports) into the
registry. Scope entries may be nested paths (`journal/imports/roam-pages-export`).

```jsonc
// <vault>/meta/kg/config.json (optional, part of the truth layer)
{ "scope": ["knowledge", "curriculum", "journal/daily-feed"],
  "wikiLinkStoplist": ["TODO", "DONE", "本周工作"] }
```

## 3. L1 — build the concept layer first

The concept table is the controlled vocabulary L2 links against; building it
first solves cross-document entity dedup. The LLM does the judgment, the CLI
only stores.

```bash
kg concept prep <vault> [--scope ...]      # dump {hash,path,title,headings} skeleton
# → you read the skeleton (and sample docs) and produce a concepts JSON array:
#   [{"canonical":"RAG","display":"RAG","type":"concept",
#     "aliases":["检索增强生成","retrieval-augmented generation"],"summary":"..."}]
kg concept import <vault> concepts.json    # merge (append-only: dedups, unions aliases)
kg concept list <vault> [--type paper]
kg concept resolve <name> <vault>          # alias/canonical → concept id
```

Concept `type` ∈ `paper|concept|method|framework|person|doc|section`. Import is
**additive** — you can grow the table over time; it never drops concepts.

## 4. L2 — extract per-document connections

Loop over documents that lack metadata, one at a time (parallelizable across
sub-agents — each doc is independent):

```bash
kg pending <vault> [--limit N]             # docs with no metadata/<hash>.json yet
```

For each pending doc: read its full text **plus the current concept table**, then
emit a metadata record and import it:

```jsonc
// doc.kg.json
{ "hash": "<the doc's hash from `kg pending`>",
  "summary": "...", "doc_type": "note|paper-notes|index|readme", "tags": ["..."],
  "mentions": [
    {"concept": "rag", "anchor": {"quote": "<verbatim substring of THIS doc>"}}
  ],
  "relations": [
    {"from": "skillopt", "relation": "builds_on", "to": "textgrad",
     "anchor": {"quote": "<verbatim substring>"}, "method": "llm", "confidence": 0.9}
  ]
}
```

```bash
kg metadata import <vault> doc.kg.json [--create-missing]
kg metadata validate <vault>               # re-check all anchors + concept refs + orphans
```

**Anchor rule (anti-hallucination):** every `anchor.quote` MUST be a verbatim
substring of the document with that hash. `import` validates it (grep -F style)
and **rejects** the record otherwise — do not paraphrase. `concept` values must
resolve in the concept table; use `--create-missing` to mint them on the fly, or
add them via L1 first. Pass records on stdin with `-` as the path.

## 5. Structural pre-fill (deterministic, no LLM)

Free, exact edges from markdown structure — also a no-LLM smoke test:

```bash
kg extract-structural <vault> <rel-path>           # print a metadata record
kg extract-structural <vault> <rel-path> --write   # validate + write it + mint arxiv papers
kg extract-structural <vault> --pending --write    # batch: every doc still lacking metadata
```

Extracts, all as `method:"deterministic"` (confidence 1.0):

- relative md-link edges (`doc_links`, target resolved to its hash)
- arXiv ids (guarded so date-like `0324.1227` is not mistaken for a paper)
- `[[wiki-links]]` (Roam/Logseq style, fenced code blocks skipped):
  resolved to a doc by **title** (same-dir sibling first, else globally unique;
  ambiguous → skipped) and/or to an **existing** concept via the alias index
  (→ mention anchored to the containing line). Never auto-creates concepts —
  a Roam export's thousands of link targets can't pollute the vocabulary.
  Names in `wikiLinkStoplist` (status markers like TODO) are ignored;
  everything unresolved lands in `_dangling`.

The `--pending` batch is the cheap first pass after widening scope: it clears
the pending queue with structural-only records, so the LLM layer (L2) can then
proceed in prioritized waves via the default merge semantics of
`kg metadata import` (union — structural and LLM layers coexist).

## 6. Inspect one file (no registry needed)

```bash
kg doc <file>      # hash, title, heading count, links, arxiv ids
kg gc <vault>      # delete orphan metadata (hash no longer in registry)
```

## 7. Show sources back to the user

When you surface an entity, edge, or doc, render its source as a clickable link
so the user can jump to the note. Resolve hash → path via the registry, then:

```
vscode://file/<abs-path>     (preferred)   ·   file://<abs-path>   (fallback)
```

## Trust tiers

Prefer `method:"deterministic"` edges (verifiable links/arxiv) when answering;
label `method:"llm"` edges as AI-inferred. Every edge carries its source doc and
a verbatim anchor — cite them.

## Scope & non-goals

DO: scan/registry, build the concept layer, drive per-doc LLM extraction into
validated files, deterministic structural pre-fill.
DON'T: edit vault notes (use Read/Edit), call any LLM from inside the CLI (the
LLM is you, on the agent side), or treat SQLite as truth.

## Phase 2 — SQLite graph index (fast queries)

A rebuildable index over the files for fast graph/full-text queries (node:sqlite
FTS5 + @node-rs/jieba CJK tokenization, both bundled with the package install).
The DB lives at `~/.cache/kg/<sha1(vault)>.db` and is disposable — `kg db build`
recreates it from the files. Build it after any `scan`/`import`.

```bash
kg db build <vault>                 # rebuild index from meta/kg/*
kg db stats <vault>                 # counts: documents/entities/edges, by type/method
kg search "<query>" <vault>         # jieba FTS5 full-text over documents
kg entity <name> <vault>            # one entity's out/in edges + mentions (alias-resolved)
kg neighbors <name> <vault> [--depth N]
kg paths <a> <b> <vault> [--max-hops N]
kg export <vault> [--method deterministic|llm] [--min-conf F]   # {nodes, edges} for viz
```

Query exit codes: `3` no index (run `kg db build`), `4` index schema stale.

## Phase 3 — `kg serve` local viewer

A read-only, view-only UI over the Phase 2 index, bound to 127.0.0.1 (never
exposed). No chat/QA in the UI — answering questions is YOUR job (see below).

```bash
kg serve <vault> [--port 8765]      # then open http://127.0.0.1:8765/
```

Pages: home (stats / top entities / browse by type), entity hub (out/in edges
with method badge + confidence + verbatim quote + ↗ provenance), doc reading
page (rendered md + KaTeX, `?cite=<quote>` scroll-and-highlight, vscode:// open,
source-view fallback), graph (Focus ego view / Overview skeleton, filters,
edge-click anchor card).

## Answering questions from the graph (agent-side QA)

When the user asks a knowledge question about the vault, query the graph
yourself — don't grep the vault blindly. **Pure local, no server needed**:

```bash
kg qa "<question>" <vault>          # entities spotted + shortest path + FTS hits
kg entity <name> <vault>            # full aggregation: edges + anchors + source docs
kg paths <a> <b> <vault>            # how two entities connect
kg doc-info <hash> <vault>          # hash → path/title + extracted metadata
kg locate <hash> "<quote>" <vault>  # verbatim quote → line number
```

QA recipe: `kg qa` spots entities and pulls their top edges → prefer
`deterministic` edges, mind `confidence` on llm ones → when an anchor alone is
too thin, read the source md (`doc-info` gives the path) → answer with
citations: `path` + verbatim anchor quote (+ line via `locate`).

If `kg serve` happens to be running, the same surface is available over HTTP
(`/api/{qa,entity,paths,doc,locate,search,neighbors,stats,graph,edge,concepts}`
+ `/raw/<hash>` for md source), and you can hand the user deep links:
`http://127.0.0.1:8765/#/doc/<hash>?cite=<urlencoded quote>`. The server is for
human eyes; never required for your own queries.
