// Home: stats + cross-era bridges (serendipity surface) + area/era axes +
// hot entities + grouped doc browser. One cached /api/graph drives everything.

import {
  api, esc, fullGraph, homeModel, eraOf, ERA_LABELS,
  typeBadge, entityHref, docHref,
} from '/util.js';

const bridgeCards = (bridges) => bridges.slice(0, 24).map(({ node, roam, knowledge }) => `
  <a class="card bridge-card" href="${entityHref(node.label)}">
    <div class="card-name">${esc(node.label)}</div>
    <div>${typeBadge(node.type)}
      <span class="muted">旧 ${roam} · 今 ${knowledge}</span></div>
  </a>`).join('');

const docGroups = (docs, filter) => {
  const groups = new Map();
  for (const d of docs) {
    if (filter.area && d.path.split('/')[0] !== filter.area) continue;
    if (filter.era && eraOf(d.path) !== filter.era) continue;
    const key = d.path.split('/')[0];
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(d);
  }
  return [...groups.entries()].sort((a, b) => b[1].length - a[1].length)
    .map(([dir, items]) => `
      <details class="doc-group">
        <summary>${esc(dir)} <span class="muted">(${items.length})</span></summary>
        <ul class="plain doclist">${items
          .sort((a, b) => a.path.localeCompare(b.path))
          .map((d) => `<li><a href="${docHref(d.hash)}">${esc(d.label)}</a>
            <span class="muted">${esc(d.path)}</span></li>`).join('')}
        </ul>
      </details>`).join('') || '<p class="muted">无匹配文档</p>';
};

export async function renderHome(el) {
  const [stats, graph] = await Promise.all([api('stats'), fullGraph()]);
  const model = homeModel(graph);
  const docs = graph.nodes.filter((n) => n.kind === 'doc');
  const entities = graph.nodes.filter((n) => n.kind === 'entity')
    .sort((a, b) => (b.weight || 0) - (a.weight || 0));
  const filter = { area: null, era: null };

  el.innerHTML = `
    <div class="statbar">
      ${stats.documents} 文档 · ${stats.entities} 实体 · ${stats.edges} 边
      <span class="muted">（确定 ${stats.edges_by_method.deterministic || 0} ·
        抽取 ${stats.edges_by_method.llm || 0}）</span>
    </div>
    ${model.bridges.length ? `<section><h2>跨时代桥梁
        <span class="muted small">2021-23 想过、现在又在研究的概念（${model.bridges.length}）</span></h2>
      <div class="cards">${bridgeCards(model.bridges)}</div></section>` : ''}
    <section><h2>热门实体</h2><div class="cards">
      ${entities.slice(0, 8).map((n) => `
        <a class="card" href="${entityHref(n.label)}">
          <div class="card-name">${esc(n.label)}</div>
          <div>${typeBadge(n.type)} <span class="muted">·${n.weight}</span></div>
        </a>`).join('')}
    </div></section>
    <section><h2>按类型浏览</h2><div class="tabs">
      ${Object.entries(stats.entities_by_type).map(([t, n]) =>
        `<button class="tab" data-type="${esc(t)}">${esc(t)} ${n}</button>`).join('')}
    </div><ul id="type-list" class="plain cols-list"></ul></section>
    <section><h2>文档（${docs.length}）</h2>
      <div class="chips" id="area-chips">
        ${model.areas.map(([a, n]) =>
          `<button class="chip" data-area="${esc(a)}">${esc(a)} <span class="muted">${n}</span></button>`).join('')}
      </div>
      <div class="chips" id="era-chips" style="margin-top:8px">
        ${Object.entries(model.eras).map(([e2, n]) =>
          `<button class="chip" data-era="${esc(e2)}">${esc(ERA_LABELS[e2] || e2)} <span class="muted">${n}</span></button>`).join('')}
      </div>
      <div class="doc-groups" id="doc-groups"></div>
    </section>`;

  const groupsEl = el.querySelector('#doc-groups');
  const redrawDocs = () => { groupsEl.innerHTML = docGroups(docs, filter); };
  const wireChips = (sel, key) => {
    el.querySelectorAll(`${sel} .chip`).forEach((b) => b.addEventListener('click', () => {
      filter[key] = filter[key] === b.dataset[key] ? null : b.dataset[key];
      el.querySelectorAll(`${sel} .chip`).forEach((x) =>
        x.classList.toggle('active', x.dataset[key] === filter[key]));
      redrawDocs();
    }));
  };
  wireChips('#area-chips', 'area');
  wireChips('#era-chips', 'era');
  redrawDocs();

  const list = el.querySelector('#type-list');
  el.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    el.querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === b));
    list.innerHTML = entities.filter((n) => n.type === b.dataset.type).map((n) =>
      `<li><a href="${entityHref(n.label)}">${esc(n.label)}</a>
       <span class="muted">·${n.weight}</span></li>`).join('');
  }));
}
