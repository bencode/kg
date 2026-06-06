// Search results: entity name matches + bm25 full-text hits.

import { api, esc, typeBadge, entityHref, docHref } from '/util.js';

export async function renderSearch(el, q) {
  const [hits, concepts] = await Promise.all([api('search', { q, limit: 30 }), api('concepts')]);
  const ql = q.toLowerCase();
  const matched = concepts.filter((c) =>
    [c.canonical, c.display, ...(c.aliases || [])].some((n) => n.toLowerCase().includes(ql)));
  el.innerHTML = `
    <h1>搜索：“${esc(q)}”</h1>
    ${matched.length ? `<section><h2>实体（${matched.length}）</h2>
      <div class="cards">${matched.slice(0, 12)
        .map((c) => `<a class="card" href="${entityHref(c.canonical)}">
          <div class="card-name">${esc(c.display)}</div><div>${typeBadge(c.type)}</div></a>`)
        .join('')}</div></section>` : ''}
    <section><h2>全文 bm25（${hits.length}）</h2><ul class="plain doclist cols-list">
      ${hits.map((h) => `<li><a href="${docHref(h.hash)}">${esc(h.title)}</a>
        <span class="muted">${esc(h.path)}</span></li>`).join('') || '<li class="muted">无结果</li>'}
    </ul></section>`;
}
