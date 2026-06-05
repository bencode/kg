// Shared domain types — the language-level mirror of the files-as-truth schema.
// Exported as `kg/types` for future consumers (e.g. the React viewer).

export type Doc = {
  hash: string;
  path: string;
  title: string;
  mtime: number;
  size: number;
};

export type ConceptType =
  | 'section'
  | 'doc'
  | 'concept'
  | 'framework'
  | 'method'
  | 'person'
  | 'paper'
  | (string & {});

export type Concept = {
  id: string;
  canonical: string;
  display: string;
  type: ConceptType;
  aliases: string[];
  summary: string;
};

export type Anchor = { quote: string; heading?: string };

export type Mention = {
  concept: string;
  anchor?: Anchor;
  method?: string;
};

export type Relation = {
  from: string;
  relation: string;
  to: string;
  anchor?: Anchor;
  method?: string;
  confidence?: number;
};

export type DocLink = {
  to_hash: string;
  to_path?: string;
  raw?: string;
  method?: string;
};

export type MetadataRecord = {
  hash: string;
  path?: string;
  summary?: string;
  doc_type?: string;
  tags?: string[];
  mentions?: Mention[];
  relations?: Relation[];
  doc_links?: DocLink[];
  _dangling?: string[];
};

export type ScanResult = {
  scanned: number;
  new: number;
  changed: number;
  unchanged: number;
  deleted: number;
  total: number;
};

export type NodeRef =
  | { kind: 'entity'; name: string; type: string }
  | { kind: 'doc'; title: string; path: string; hash: string };

export type EdgeOut = {
  relation: string;
  to: NodeRef;
  method: string;
  confidence: number | null;
  anchor: string | null;
  source: SourceDoc | null;
};

export type EdgeIn = {
  relation: string;
  from: NodeRef;
  method: string;
  confidence: number | null;
  anchor: string | null;
  source: SourceDoc | null;
};

export type SourceDoc = { hash: string; path: string; title: string };

export type EntityAggregate = {
  entity: {
    name: string;
    type: string;
    mention_count: number;
    summary: string;
    aliases: string[];
  };
  out_edges: EdgeOut[];
  in_edges: EdgeIn[];
};

export type GraphNode = {
  id: string;
  label: string;
  kind: 'entity' | 'doc';
  type: string;
  weight?: number;
  path?: string;
  hash?: string;
};

export type GraphEdge = {
  source: string;
  target: string;
  relation: string;
  method: string;
  confidence: number;
};

export type GraphExport = { nodes: GraphNode[]; edges: GraphEdge[] };
