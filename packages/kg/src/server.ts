// kg serve — read-only local viewer over the Phase 2 index.
//
// node:http bound to 127.0.0.1. Three response families: /api/* (JSON wrappers
// over queries/api), /raw/<hash> (md source, hash whitelisted through the
// registry), and static viewer assets from packages/kg/viewer/.

import { existsSync, readFileSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as api from './api.js';
import * as queries from './queries.js';
import { viewerAssets } from './viewer-assets.js';

const VIEWER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'viewer');

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

type Params = URLSearchParams;
type Handler = (p: Params) => unknown;

const apiRoutes = (vault: string): Record<string, Handler> => ({
  stats: () => queries.stats(vault),
  search: (p) => queries.search(vault, p.get('q') ?? '', Number(p.get('limit') ?? 20)),
  entity: (p) => queries.entity(vault, p.get('name') ?? ''),
  neighbors: (p) => queries.neighbors(vault, p.get('name') ?? '', Number(p.get('depth') ?? 1)),
  paths: (p) =>
    queries.paths(vault, p.get('a') ?? '', p.get('b') ?? '', Number(p.get('max_hops') ?? 4)),
  graph: (p) => queries.exportGraph(vault, p.get('method'), Number(p.get('min_conf') ?? 0)),
  edge: (p) =>
    queries.edgeDetail(vault, p.get('source') ?? '', p.get('target') ?? '', p.get('relation')),
  concepts: (p) => api.conceptList(vault, p.get('type')),
  doc: (p) => api.docInfo(vault, p.get('hash') ?? ''),
  locate: (p) => api.locate(vault, p.get('hash') ?? '', p.get('quote') ?? ''),
  qa: (p) => api.qa(vault, p.get('q') ?? ''),
});

const send = (res: ServerResponse, status: number, type: string, body: Buffer | string): void => {
  const buf = typeof body === 'string' ? Buffer.from(body, 'utf-8') : body;
  res.writeHead(status, {
    'Content-Type': `${type}; charset=utf-8`,
    'Content-Length': buf.length,
    'Cache-Control': 'no-cache',
  });
  res.end(buf);
};

const sendJson = (res: ServerResponse, obj: unknown, status = 200): void => {
  send(res, status, 'application/json', JSON.stringify(obj));
};

const handleStatic = (res: ServerResponse, parts: string[]): void => {
  const name = parts.at(-1) ?? 'index.html';
  // single flat dir: reject anything that is not a plain filename in viewer/
  if (parts.length > 1 || name.includes('/') || name.startsWith('.')) {
    send(res, 404, 'text/plain', 'not found');
    return;
  }
  const ext = name.slice(name.lastIndexOf('.'));
  const mime = MIME[ext] ?? 'application/octet-stream';
  // disk first (dev / package install); embedded fallback (compiled binary,
  // where import.meta.url points into the bundle and viewer/ has no real path)
  const target = resolve(VIEWER_DIR, name);
  if (target.startsWith(VIEWER_DIR) && existsSync(target) && statSync(target).isFile()) {
    send(res, 200, mime, readFileSync(target));
    return;
  }
  const embedded = viewerAssets[name];
  if (embedded !== undefined) {
    send(res, 200, mime, embedded);
    return;
  }
  send(res, 404, 'text/plain', 'not found');
};

const handle = (vault: string, req: IncomingMessage, res: ServerResponse): void => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const parts = url.pathname.split('/').filter(Boolean);
  try {
    if (parts[0] === 'api') {
      const routes = apiRoutes(vault);
      const route = parts.length === 2 ? routes[parts[1]!] : undefined;
      if (route === undefined) {
        sendJson(res, { error: 'unknown endpoint' }, 404);
        return;
      }
      sendJson(res, route(url.searchParams) ?? null);
    } else if (parts[0] === 'raw') {
      if (parts.length !== 2) {
        sendJson(res, { error: 'usage: /raw/<hash>' }, 400);
        return;
      }
      send(res, 200, 'text/plain', api.rawText(vault, parts[1]!));
    } else {
      handleStatic(res, parts);
    }
  } catch (e) {
    if (e instanceof api.DocNotFound) sendJson(res, { error: `unknown hash: ${e.message}` }, 404);
    else if (e instanceof queries.IndexMissing) sendJson(res, { error: e.message }, 503);
    else if (e instanceof queries.IndexStale) sendJson(res, { error: e.message }, 503);
    else sendJson(res, { error: `bad request: ${e}` }, 400);
  }
};

export const serve = (vault: string, port = 8765): void => {
  const server = createServer((req, res) => handle(vault, req, res));
  server.listen(port, '127.0.0.1', () => {
    console.log(`kg viewer: http://127.0.0.1:${port}/  (vault: ${vault})`);
  });
};

export { VIEWER_DIR };
