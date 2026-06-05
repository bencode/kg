// Hash router + home view (A).

import { api, esc, errBox, spinner, typeBadge, entityHref, docHref } from '/util.js';
import { renderEntity } from '/entity.js';
import { renderDoc } from '/doc.js';
import { renderGraph } from '/graph.js';

const app = document.getElementById('app');

const route = async () => {
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  app.innerHTML = spinner;
  try {
    if (parts.length === 0) await renderHome(app, params);
    else if (parts[0] === 'entity') await renderEntity(app, decodeURIComponent(parts[1] || ''));
    else if (parts[0] === 'doc') await renderDoc(app, parts[1], params.get('cite'));
    else if (parts[0] === 'graph') await renderGraph(app, params.get('focus'));
    else if (parts[0] === 'search') await renderSearch(app, params.get('q') || '');
    else app.innerHTML = '<p class="error">未知页面</p>';
  } catch (e) {
    app.innerHTML = errBox(e);
  }
};

async function renderHome(el) {
  const stats = await api('stats');
  const byType = stats.entities_by_type;
  const graph = await api('graph', { min_conf: 1.1 }); // nodes only (edges filtered out)
  const entities = graph.nodes.filter((n) => n.kind === 'entity')
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const docs = graph.nodes.filter((n) => n.kind === 'doc');
  el.innerHTML = `
    <div class="statbar">
      ${stats.documents} 文档 · ${stats.entities} 实体 · ${stats.edges} 边
      <span class="muted">（确定 ${stats.edges_by_method.deterministic || 0} ·
        抽取 ${stats.edges_by_method.llm || 0}）</span>
    </div>
    <section><h2>热门实体</h2><div class="cards">
      ${entities.slice(0, 12).map((n) => `
        <a class="card" href="${entityHref(n.label)}">
          <div class="card-name">${esc(n.label)}</div>
          <div>${typeBadge(n.type)} <span class="muted">·${n.weight}</span></div>
        </a>`).join('')}
    </div></section>
    <section><h2>按类型浏览</h2><div class="tabs">
      ${Object.entries(byType).map(([t, n]) =>
        `<button class="tab" data-type="${esc(t)}">${esc(t)} ${n}</button>`).join('')}
    </div><ul id="type-list" class="plain"></ul></section>
    <section><h2>文档（${docs.length}）</h2>
      <ul class="plain doclist">${docs
        .sort((a, b) => a.path.localeCompare(b.path))
        .map((d) => `<li><a href="${docHref(d.hash)}">${esc(d.label)}</a>
          <span class="muted">${esc(d.path)}</span></li>`).join('')}
      </ul></section>`;
  const list = el.querySelector('#type-list');
  el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    const items = entities.filter((n) => n.type === b.dataset.type);
    list.innerHTML = items.map((n) =>
      `<li><a href="${entityHref(n.label)}">${esc(n.label)}</a>
       <span class="muted">·${n.weight}</span></li>`).join('');
  }));
}

async function renderSearch(el, q) {
  const [hits, concepts] = await Promise.all([api('search', { q, limit: 30 }), api('concepts')]);
  const ql = q.toLowerCase();
  const matched = concepts.filter((c) =>
    [c.canonical, c.display, ...(c.aliases || [])].some((n) => n.toLowerCase().includes(ql)));
  el.innerHTML = `
    <h2>搜索：“${esc(q)}”</h2>
    ${matched.length ? `<section><h3>实体</h3><div class="cards">${matched.slice(0, 8)
      .map((c) => `<a class="card" href="${entityHref(c.canonical)}">
        <div class="card-name">${esc(c.display)}</div><div>${typeBadge(c.type)}</div></a>`)
      .join('')}</div></section>` : ''}
    <section><h3>全文（bm25）</h3><ul class="plain doclist">
      ${hits.map((h) => `<li><a href="${docHref(h.hash)}">${esc(h.title)}</a>
        <span class="muted">${esc(h.path)}</span></li>`).join('') || '<li class="muted">无结果</li>'}
    </ul></section>`;
}

document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim())
    location.hash = `/search?q=${encodeURIComponent(e.target.value.trim())}`;
});

window.addEventListener('hashchange', route);
route();
