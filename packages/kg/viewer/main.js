// Hash router. Pages are one-file modules; the table maps each route to its
// renderer and shell archetype (data = dense full-width, prose = reading
// column, canvas = fixed-viewport).

import { errBox, spinner } from '/util.js';
import { renderHome } from '/home.js';
import { renderSearch } from '/search.js';
import { renderEntity } from '/entity.js';
import { renderDoc } from '/doc.js';
import { renderGraph } from '/graph.js';

const app = document.getElementById('app');

const routes = {
  '': { shell: 'data', go: (parts, p) => renderHome(app, p) },
  entity: { shell: 'data', go: (parts) => renderEntity(app, decodeURIComponent(parts[1] || '')) },
  doc: { shell: 'prose', go: (parts, p) => renderDoc(app, parts[1], p.get('cite')) },
  graph: { shell: 'canvas', go: (parts, p) => renderGraph(app, p.get('focus')) },
  search: { shell: 'data', go: (parts, p) => renderSearch(app, p.get('q') || '') },
};

const setNav = (key) => {
  document.querySelectorAll('.topbar nav a').forEach((a) => {
    const target = a.getAttribute('href').slice(2).split('/')[0] || '';
    if (target === key) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
};

const route = async () => {
  const hash = location.hash.slice(1) || '/';
  const [path, query] = hash.split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  const r = routes[parts[0] || ''];
  if (!r) { app.innerHTML = '<p class="error">未知页面</p>'; return; }
  app.className = `shell-${r.shell}`;
  setNav(parts[0] || '');
  app.innerHTML = spinner;
  try {
    await r.go(parts, params);
  } catch (e) {
    app.innerHTML = errBox(e);
  }
};

document.getElementById('global-search').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.value.trim())
    location.hash = `/search?q=${encodeURIComponent(e.target.value.trim())}`;
});

window.addEventListener('hashchange', route);
route();
