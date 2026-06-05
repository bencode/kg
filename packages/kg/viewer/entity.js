// Entity hub page (B): header + out/in edges with provenance + mentioning docs.

import { api, esc, typeBadge, edgeRow, entityHref, docHref, truncate } from '/util.js';

export async function renderEntity(el, name) {
  const data = await api('entity', { name });
  if (!data) { el.innerHTML = `<p class="error">没有这个实体：${esc(name)}</p>`; return; }
  const e = data.entity;
  // doc→entity "mentions" edges are listed as 提及文档, the rest as relation edges
  const isMention = (r) => r.relation === 'mentions' && r.from?.kind === 'doc';
  const mentions = data.in_edges.filter(isMention);
  const inEdges = data.in_edges.filter((r) => !isMention(r));
  el.innerHTML = `
    <div class="entity-head">
      <h1>${esc(e.name)} ${typeBadge(e.type)}
        <span class="muted">被 ${e.mention_count} 篇提及</span></h1>
      ${e.aliases?.length ? `<p class="muted">别名：${e.aliases.map(esc).join(' · ')}</p>` : ''}
      ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
      <p><a class="btn" href="#/graph?focus=${encodeURIComponent(e.name)}">🕸 在图谱中查看</a></p>
    </div>
    <div class="cols">
      <section><h2>出边（${e.name} →）</h2>
        <ul class="plain">${data.out_edges.map((r) => edgeRow(r, 'to')).join('')
          || '<li class="muted">无</li>'}</ul></section>
      <section><h2>入边（→ ${esc(e.name)}）</h2>
        <ul class="plain">${inEdges.map((r) => edgeRow(r, 'from')).join('')
          || '<li class="muted">无</li>'}</ul></section>
    </div>
    <section><h2>被这些文档提及（${mentions.length}）</h2>
      <ul class="plain doclist">${mentions.map((r) => `
        <li><a href="${docHref(r.from.hash, r.anchor)}">${esc(r.from.title)}</a>
          ${r.anchor ? `<span class="muted">“${esc(truncate(r.anchor, 60))}”</span>` : ''}
          <a class="cite" href="${docHref(r.from.hash, r.anchor)}">↗</a></li>`).join('')
        || '<li class="muted">无</li>'}</ul></section>`;
}
