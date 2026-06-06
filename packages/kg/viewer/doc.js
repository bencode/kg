// Document reading page (C): rendered md + cite highlight with 3-tier fallback.
//
// Tier 1 (default cite target): rendered view, TreeWalker match on a
// markdown-stripped projection of the quote. Tier 2: source view — quote is a
// verbatim substring of the md source (validated at import), indexOf always
// hits. Tier 3: visible notice, never a silent failure.

import { api, rawDoc, esc, entityHref, docHref, methodBadge, truncate } from '/util.js';

const MATH_TOKEN = 'KGMATH';

const renderMarkdown = (md) => {
  const maths = [];
  const tokenized = md.replace(/\$\$[\s\S]+?\$\$|\$[^$\n]+\$/g, (m) => {
    maths.push(m);
    return `${MATH_TOKEN}${maths.length - 1}END`;
  });
  let html = marked.parse(tokenized);
  html = html.replace(new RegExp(`${MATH_TOKEN}(\\d+)END`, 'g'), (_, i) => {
    const m = maths[+i];
    const display = m.startsWith('$$');
    const tex = m.replace(/^\$+|\$+$/g, '');
    try { return katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
    catch { return esc(m); }
  });
  return html;
};

// The chrome <h1> already shows the title; drop a duplicating leading md H1
// from the RENDERED view only (source view stays verbatim for cite tier 2).
const stripDupTitle = (md, title) => {
  const m = /^\s*#\s+(.+?)\s*\n/.exec(md);
  return m && m[1].trim() === title.trim() ? md.slice(m[0].length) : md;
};

// Strip md markers so the quote matches rendered textContent.
const projectQuote = (q) => q
  .replace(/```[a-z]*\n?/g, '').replace(/^#+\s*/gm, '')
  .replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1')
  .replace(/`([^`]+)`/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .replace(/\s+/g, ' ').trim();

const highlightRendered = (container, quote) => {
  const target = projectQuote(quote);
  if (!target) return false;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let text = '';
  const nodes = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    nodes.push({ node: n, start: text.length });
    text += n.textContent;
  }
  const flat = text.replace(/\s+/g, ' ');
  // map collapsed index back: search on collapsed text, locate via running scan
  const idx = flat.indexOf(target);
  if (idx < 0) return false;
  // walk原始 text 找到与 collapsed 索引对应的真实区间
  let ci = 0; let startReal = -1; let endReal = -1;
  for (let i = 0; i < text.length; i++) {
    const isWs = /\s/.test(text[i]);
    if (isWs && ci > 0 && /\s/.test(flat[ci - 1] || '')) continue; // collapsed run
    if (ci === idx && startReal < 0) startReal = i;
    if (ci === idx + target.length) { endReal = i; break; }
    ci += 1;
  }
  if (startReal < 0) return false;
  if (endReal < 0) endReal = text.length;
  // wrap per text node — one range across element boundaries (e.g. into a
  // <code>) makes surroundContents throw
  let first = null;
  for (const { node, start } of nodes) {
    const s = Math.max(startReal - start, 0);
    const e = Math.min(endReal - start, node.textContent.length);
    if (s >= e) continue;
    const range = document.createRange();
    range.setStart(node, s);
    range.setEnd(node, e);
    const mark = document.createElement('mark');
    try { range.surroundContents(mark); } catch { continue; }
    first ??= mark;
  }
  if (first) first.scrollIntoView({ block: 'center' });
  return Boolean(first);
};

const highlightSource = (pre, source, quote) => {
  const idx = source.indexOf(quote);
  if (idx < 0) return false;
  pre.innerHTML = `${esc(source.slice(0, idx))}<mark>${esc(quote)}</mark>${esc(source.slice(idx + quote.length))}`;
  pre.querySelector('mark').scrollIntoView({ block: 'center' });
  return true;
};

const extractPanel = (meta) => {
  if (!meta) return '<p class="muted">（尚未抽取）</p>';
  const m = (meta.mentions || []).map((x) => `
    <li><a href="${entityHref(x.concept)}">${esc(x.concept)}</a>
      ${x.anchor?.quote ? `<button class="cite jump" data-q="${esc(x.anchor.quote)}">↗</button>` : ''}</li>`);
  const r = (meta.relations || []).map((x) => `
    <li>${esc(x.from)} ─${esc(x.relation)}→ ${esc(x.to)} ${methodBadge(x.method, x.confidence)}
      ${x.anchor?.quote ? `<button class="cite jump" data-q="${esc(x.anchor.quote)}">↗</button>` : ''}</li>`);
  const l = (meta.doc_links || []).map((x) =>
    `<li><a href="${docHref(x.to_hash)}">${esc(truncate(x.raw || x.to_hash, 40))}</a></li>`);
  return `
    ${meta.summary ? `<p class="summary">${esc(meta.summary)}</p>` : ''}
    <h3>提及（${m.length}）</h3><ul class="plain">${m.join('') || '<li class="muted">无</li>'}</ul>
    <h3>关系（${r.length}）</h3><ul class="plain">${r.join('') || '<li class="muted">无</li>'}</ul>
    ${l.length ? `<h3>文档链接（${l.length}）</h3><ul class="plain">${l.join('')}</ul>` : ''}`;
};

export async function renderDoc(el, hash, cite) {
  const [info, source] = await Promise.all([api('doc', { hash }), rawDoc(hash)]);
  el.innerHTML = `
    <div class="doc-layout">
      <aside class="doc-side"><h2>本文抽取</h2>${extractPanel(info.metadata)}</aside>
      <article class="doc-main">
        <div class="doc-head">
          <h1>${esc(info.title)}</h1>
          <div class="doc-actions">
            <span class="muted">${esc(info.path)}</span>
            <button id="view-toggle">源码视图</button>
            <a class="btn" href="${esc(info.vscode_url)}">在编辑器打开 ↗</a>
          </div>
          <div id="cite-notice" class="hidden"></div>
        </div>
        <div id="doc-rendered" class="md-body"></div>
        <pre id="doc-source" class="hidden"></pre>
      </article>
    </div>`;
  const rendered = el.querySelector('#doc-rendered');
  const pre = el.querySelector('#doc-source');
  const notice = el.querySelector('#cite-notice');
  rendered.innerHTML = renderMarkdown(stripDupTitle(source, info.title));
  pre.textContent = source;
  const toggle = el.querySelector('#view-toggle');
  const setMode = (src) => {
    rendered.classList.toggle('hidden', src);
    pre.classList.toggle('hidden', !src);
    toggle.textContent = src ? '渲染视图' : '源码视图';
  };
  toggle.addEventListener('click', () => setMode(pre.classList.contains('hidden')));

  const jumpTo = (quote) => {
    notice.classList.add('hidden');
    setMode(false);
    rendered.querySelectorAll('mark').forEach((m) => m.replaceWith(...m.childNodes));
    if (highlightRendered(rendered, quote)) return;       // tier 1
    setMode(true);
    if (highlightSource(pre, source, quote)) return;      // tier 2
    notice.textContent = '⚠ 无法精确定位该引文（文档可能已变更），已显示全文。'; // tier 3
    notice.classList.remove('hidden');
  };
  el.querySelectorAll('.jump').forEach((b) =>
    b.addEventListener('click', () => jumpTo(b.dataset.q)));
  if (cite) jumpTo(cite);
}
