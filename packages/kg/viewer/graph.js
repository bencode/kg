// Graph view (D): Focus (ego) / Overview (skeleton) over a cached full export.

import { api, esc, TYPE_COLORS, typeBadge, methodBadge, entityHref, docHref } from '/util.js';

let cache = null; // {nodes, edges} — one export per session, filtered client-side
const getGraph = async () => (cache ??= await api('graph'));

const SIZE = (w) => Math.min(56, Math.max(14, 14 + 6 * Math.sqrt(w || 1)));

const STYLE = [
  { selector: 'node[kind="entity"]', style: {
    'background-color': (n) => TYPE_COLORS[n.data('type')] || '#888',
    width: (n) => SIZE(n.data('weight')), height: (n) => SIZE(n.data('weight')),
    label: 'data(label)', 'font-size': 10, color: '#2A2A28',
    'text-valign': 'bottom', 'text-margin-y': 4, 'min-zoomed-font-size': 8 } },
  { selector: 'node[kind="doc"]', style: {
    shape: 'round-rectangle', 'background-color': '#E8E8E4', 'border-width': 1,
    'border-color': '#999', width: 16, height: 12, label: 'data(label)',
    'font-size': 8, color: '#777', 'text-valign': 'bottom', 'min-zoomed-font-size': 10 } },
  { selector: 'node.focus', style: { 'border-width': 4, 'border-color': '#E8A33D' } },
  { selector: 'edge', style: {
    'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'arrow-scale': 0.7,
    'line-color': '#8AAFD0', 'target-arrow-color': '#8AAFD0', 'line-style': 'dashed',
    'line-dash-pattern': [6, 3],
    width: (e) => Math.min(3.5, 1 + 2.5 * (e.data('confidence') || 0)),
    opacity: (e) => Math.min(1, 0.25 + 0.75 * (e.data('confidence') || 0)) } },
  { selector: 'edge[method="deterministic"]', style: {
    'line-style': 'solid', 'line-color': '#5B5B57', 'target-arrow-color': '#5B5B57',
    width: 2, opacity: 1 } },
  { selector: 'edge.hl', style: { 'line-color': '#E8A33D', 'target-arrow-color': '#E8A33D', opacity: 1 } },
];

const FILTERS_HTML = `
  <h3>类型</h3>
  ${Object.keys(TYPE_COLORS).map((t) => `<label>
    <input type="checkbox" class="f-type" value="${t}" ${t === 'doc' ? '' : 'checked'}>
    <i style="background:${TYPE_COLORS[t]}"></i>${t}</label>`).join('')}
  <h3>method</h3>
  <label><input type="checkbox" class="f-method" value="deterministic" checked>确定</label>
  <label><input type="checkbox" class="f-method" value="llm" checked>抽取</label>
  <h3>confidence ≥ <span id="f-conf-v">0.0</span></h3>
  <input type="range" id="f-conf" min="0" max="1" step="0.05" value="0">
  <h3>weight ≥ <span id="f-weight-v">1</span></h3>
  <input type="range" id="f-weight" min="1" max="10" step="1" value="1">`;

const readFilters = (el) => ({
  types: new Set([...el.querySelectorAll('.f-type:checked')].map((x) => x.value)),
  methods: new Set([...el.querySelectorAll('.f-method:checked')].map((x) => x.value)),
  minConf: +el.querySelector('#f-conf').value,
  minWeight: +el.querySelector('#f-weight').value,
});

function buildElements(g, mode, focus, f) {
  const nodeOk = (n) => f.types.has(n.kind === 'doc' ? 'doc' : n.type)
    && (n.kind === 'doc' || (n.weight || 0) >= f.minWeight);
  const edgeOk = (e) => f.methods.has(e.method)
    && (e.method === 'deterministic' || e.confidence >= f.minConf);
  let nodes; let edges;
  if (mode === 'focus' && focus) {
    const fnode = g.nodes.find((n) => n.kind === 'entity' && n.label === focus);
    if (!fnode) return { nodes: [], edges: [] };
    const near = new Set([fnode.id]);
    g.edges.forEach((e) => {
      if (e.source === fnode.id) near.add(e.target);
      if (e.target === fnode.id) near.add(e.source);
    });
    nodes = g.nodes.filter((n) => near.has(n.id) && (n.id === fnode.id || nodeOk({ ...n, weight: 99 })));
    const ids = new Set(nodes.map((n) => n.id));
    edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && edgeOk(e));
  } else {
    // overview skeleton: entity-entity, high-trust, hot nodes
    nodes = g.nodes.filter((n) => n.kind === 'entity' && nodeOk(n));
    const ids = new Set(nodes.map((n) => n.id));
    edges = g.edges.filter((e) => ids.has(e.source) && ids.has(e.target) && edgeOk(e)
      && (e.method === 'deterministic' || e.confidence >= Math.max(f.minConf, 0.7)));
    const connected = new Set(edges.flatMap((e) => [e.source, e.target]));
    nodes = nodes.filter((n) => connected.has(n.id));
  }
  return {
    nodes: nodes.map((n) => ({ data: { ...n, ...(focus && n.label === focus ? { isFocus: 1 } : {}) },
                               classes: focus && n.label === focus ? 'focus' : '' })),
    edges: edges.map((e) => ({ data: { ...e, id: `${e.source}|${e.relation}|${e.target}` } })),
  };
}

const sideEntity = async (side, name) => {
  const d = await api('entity', { name });
  if (!d) return;
  side.innerHTML = `
    <h3><a href="${entityHref(name)}">${esc(name)}</a> ${typeBadge(d.entity.type)}</h3>
    <p class="muted">提及 ${d.entity.mention_count} · ${esc(d.entity.summary || '')}</p>
    <ul class="plain small">${[...d.out_edges.map((r) => `<li>─${esc(r.relation)}→ ${esc(r.to.name || r.to.title)}</li>`),
      ...d.in_edges.map((r) => `<li>${esc(r.from.name || r.from.title)} ─${esc(r.relation)}→</li>`)]
      .slice(0, 14).join('')}</ul>
    <p class="muted">双击节点 = 移动焦点</p>`;
};

const sideEdge = async (side, data) => {
  const details = await api('edge', { source: data.source, target: data.target, relation: data.relation });
  side.innerHTML = details.map((d) => `
    <div class="edge-card">
      <p>${esc(d.from.name || d.from.title)} ─<b>${esc(d.relation)}</b>→
         ${esc(d.to.name || d.to.title)} ${methodBadge(d.method, d.confidence)}</p>
      ${d.anchor ? `<blockquote>${esc(d.anchor)}</blockquote>` : ''}
      ${d.raw ? `<p class="muted">${esc(d.raw)}</p>` : ''}
      ${d.source ? `<a class="btn" href="${docHref(d.source.hash, d.anchor || undefined)}">打开原文 ↗</a>
        <span class="muted">${esc(d.source.title)}</span>` : ''}
    </div>`).join('') || '<p class="muted">无边详情</p>';
};

export async function renderGraph(el, focus) {
  const g = await getGraph();
  el.innerHTML = `
    <div class="graph-layout side-empty">
      <aside class="graph-filters">${FILTERS_HTML}</aside>
      <div class="graph-main">
        <div class="graph-bar">
          <button id="g-focus" class="tab">Focus</button>
          <button id="g-overview" class="tab">Overview</button>
          <input id="g-search" placeholder="实体名 → 设为焦点" list="g-names">
          <datalist id="g-names">${g.nodes.filter((n) => n.kind === 'entity')
            .map((n) => `<option value="${esc(n.label)}">`).join('')}</datalist>
        </div>
        <div id="cy"></div>
      </div>
      <aside class="graph-side" id="g-side"><p class="muted">点节点/边看详情</p></aside>
    </div>`;
  let mode = focus ? 'focus' : 'overview';
  let focusName = focus || null;
  const side = el.querySelector('#g-side');
  const layoutEl = el.querySelector('.graph-layout');
  const openSide = () => {
    layoutEl.classList.remove('side-empty');
    cy.resize(); // canvas shrinks when the side panel opens
  };
  const cy = cytoscape({
    container: el.querySelector('#cy'), style: STYLE,
    wheelSensitivity: 0.3, textureOnViewport: true, hideEdgesOnViewport: true,
  });
  window.kgCy = cy; // debug/test handle
  const redraw = () => {
    el.querySelector('#g-focus').classList.toggle('active', mode === 'focus');
    el.querySelector('#g-overview').classList.toggle('active', mode === 'overview');
    const els = buildElements(g, mode, focusName, readFilters(el));
    cy.elements().remove();
    cy.add([...els.nodes, ...els.edges]);
    const layout = mode === 'focus'
      ? { name: 'concentric', concentric: (n) => (n.data('isFocus') ? 10 : 1),
          levelWidth: () => 1, minNodeSpacing: 30, animate: false }
      : { name: window.cytoscapeFcose ? 'fcose' : 'cose',
          quality: 'default', animate: false, nodeSeparation: 75, packComponents: true };
    cy.layout(layout).run();
  };
  cy.on('tap', 'node[kind="entity"]', (ev) => {
    openSide();
    sideEntity(side, ev.target.data('label'));
  });
  cy.on('tap', 'edge', (ev) => {
    cy.edges().removeClass('hl');
    ev.target.addClass('hl');
    openSide();
    sideEdge(side, ev.target.data());
  });
  cy.on('dbltap', 'node[kind="entity"]', (ev) => {
    focusName = ev.target.data('label');
    mode = 'focus';
    redraw();
  });
  el.querySelector('#g-focus').addEventListener('click', () => { mode = 'focus'; redraw(); });
  el.querySelector('#g-overview').addEventListener('click', () => { mode = 'overview'; redraw(); });
  el.querySelector('#g-search').addEventListener('change', (ev) => {
    if (ev.target.value) { focusName = ev.target.value; mode = 'focus'; redraw(); }
  });
  el.querySelectorAll('.graph-filters input').forEach((i) => {
    i.addEventListener('input', () => {
      el.querySelector('#f-conf-v').textContent = (+el.querySelector('#f-conf').value).toFixed(2);
      el.querySelector('#f-weight-v').textContent = el.querySelector('#f-weight').value;
      redraw();
    });
  });
  redraw();
}
