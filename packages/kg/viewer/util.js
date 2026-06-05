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
