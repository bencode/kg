// Shared helpers: API fetch, escaping, badges, routing links.

export const api = async (name, params = {}) => {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== ''));
  const res = await fetch(`/api/${name}?${qs}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return res.json();
};

export const rawDoc = async (hash) => {
  const res = await fetch(`/raw/${hash}`);
  if (!res.ok) throw new Error('文档不存在');
  return res.text();
};

export const esc = (s) => String(s ?? '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;');

// Visual encoding (from the design spec)
export const TYPE_COLORS = {
  concept: '#4C72B0', method: '#55A868', framework: '#C44E52',
  paper: '#8172B3', person: '#CCB974', reference: '#937860', doc: '#999990',
};

export const typeBadge = (type) =>
  `<span class="badge type" style="background:${TYPE_COLORS[type] || '#888'}">${esc(type)}</span>`;

export const methodBadge = (method, confidence) => method === 'deterministic'
  ? '<span class="badge det">确定</span>'
  : `<span class="badge llm">抽取 ${confidence != null ? Number(confidence).toFixed(2) : ''}</span>`;

export const entityHref = (name) => `#/entity/${encodeURIComponent(name)}`;
export const docHref = (hash, cite) =>
  `#/doc/${hash}${cite ? `?cite=${encodeURIComponent(cite)}` : ''}`;

export const truncate = (s, n = 48) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n)}…` : t;
};

// One edge row used by entity hub / QA: relation + peer + badges + quote + ↗
export const edgeRow = (edge, peerKey) => {
  const peer = edge[peerKey];
  const peerLink = peer.kind === 'entity'
    ? `<a href="${entityHref(peer.name)}">${esc(peer.name)}</a>`
    : `<a href="${docHref(peer.hash)}">${esc(peer.title)}</a>`;
  const arrow = peerKey === 'to' ? `─${esc(edge.relation)}→ ${peerLink}`
                                 : `${peerLink} ─${esc(edge.relation)}→`;
  const src = edge.source;
  const cite = edge.anchor && src
    ? ` <a class="cite" href="${docHref(src.hash, edge.anchor)}"
         title="${esc(edge.anchor)}">“${esc(truncate(edge.anchor))}” ↗</a>`
    : (src ? ` <a class="cite" href="${docHref(src.hash)}">↗</a>` : '');
  return `<li class="edge-row">${arrow} ${methodBadge(edge.method, edge.confidence)}${cite}</li>`;
};

export const spinner = '<p class="muted">加载中…</p>';
export const errBox = (e) => `<p class="error">出错了：${esc(e.message || e)}</p>`;

// One full graph export per session, shared by home (axes/bridges) and graph view.
let graphCache = null;
export const fullGraph = async () => (graphCache ??= await api('graph'));

// --- pure data shaping (kept DOM-free so a future React viewer reuses them) ---

export const areaOf = (path) => path.split('/')[0];

export const eraOf = (path) =>
  path.startsWith('journal/imports/') ? 'roam'
  : path.startsWith('journal/daily-feed/') ? 'feed'
  : /^(knowledge|curriculum|learning-paths)\//.test(path) ? 'knowledge'
  : 'other';

export const ERA_LABELS = {
  knowledge: '当前知识', roam: 'Roam 旧笔记 2021-23', feed: '每日 feed', other: '其他',
};

// {areas: [[name, count]…], eras: {era: count}, bridges: [{node, roam, knowledge}…]}
export const homeModel = (g) => {
  const docs = g.nodes.filter((n) => n.kind === 'doc');
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const areas = new Map();
  const eras = {};
  for (const d of docs) {
    areas.set(areaOf(d.path), (areas.get(areaOf(d.path)) || 0) + 1);
    eras[eraOf(d.path)] = (eras[eraOf(d.path)] || 0) + 1;
  }
  const hits = new Map(); // entity id → {roam, knowledge}
  for (const e of g.edges) {
    if (e.relation !== 'mentions') continue;
    const a = byId.get(e.source);
    const b = byId.get(e.target);
    const doc = a?.kind === 'doc' ? a : b?.kind === 'doc' ? b : null;
    const ent = a?.kind === 'entity' ? a : b?.kind === 'entity' ? b : null;
    if (!doc || !ent) continue;
    const era = eraOf(doc.path);
    if (era !== 'roam' && era !== 'knowledge') continue;
    const h = hits.get(ent.id) || { node: ent, roam: 0, knowledge: 0 };
    h[era] += 1;
    hits.set(ent.id, h);
  }
  const bridges = [...hits.values()]
    .filter((h) => h.roam > 0 && h.knowledge > 0)
    .sort((x, y) => Math.min(y.roam, y.knowledge) - Math.min(x.roam, x.knowledge)
      || (y.roam + y.knowledge) - (x.roam + x.knowledge));
  return { areas: [...areas.entries()].sort((x, y) => y[1] - x[1]), eras, bridges };
};
