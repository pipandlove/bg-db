/** A minimal static file server (for local development and for tests). */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
  '.gz': 'application/gzip', '.mat': 'text/plain; charset=utf-8', '.sgf': 'text/plain; charset=utf-8',
};

/** @returns {http.Server} (not listening yet) */
export function createStaticServer(root) {
  const base = path.resolve(root);
  return http.createServer((req, res) => {
    let url;
    try { url = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
    let file = path.join(base, url);
    if (file !== base && !file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if (!fs.existsSync(file)) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}
