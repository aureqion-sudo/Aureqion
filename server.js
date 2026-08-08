// Dev server for the static site — no dependencies, no build step.
//   npm run dev   →  http://localhost:3000
// Serves this folder as-is and live-reloads open pages when a file changes.
import { createServer } from 'node:http';
import { createReadStream, promises as fs, watch } from 'node:fs';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// The site's entry page, served at "/". Override with ENTRY=other.html npm run dev
const ENTRY = process.env.ENTRY || 'AUREQON.dc.html';
const DIR_INDEX = [ENTRY, 'index.html']; // index.html kept as a conventional fallback

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

// --- live reload -----------------------------------------------------------
const clients = new Set();
const RELOAD_SNIPPET = `
<script>
// dev-server live reload (injected by server.js — not part of the page)
new EventSource('/__reload').onmessage = () => location.reload();
</script>
`;

let reloadTimer = null;
function scheduleReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const res of clients) res.write('data: reload\n\n');
  }, 80); // debounce: editors write in bursts
}

try {
  watch(ROOT, { recursive: true }, (_event, name) => {
    if (!name) return;
    const p = String(name);
    if (p.includes('node_modules') || p.startsWith('.git') || p.endsWith('~')) return;
    scheduleReload();
  });
} catch {
  console.warn('watch: live reload unavailable on this platform — reload manually');
}

// --- request handling ------------------------------------------------------
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const rel = normalize(decoded).replace(/^([/\\])+/, '');
  if (rel === '..' || rel.startsWith('..' + sep)) return null; // no escaping ROOT
  return join(ROOT, rel);
}

const server = createServer(async (req, res) => {
  if (req.url === '/__reload') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write('retry: 1000\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  let filePath = resolvePath(req.url || '/');
  if (!filePath) {
    res.writeHead(400, { 'Content-Type': 'text/plain' }).end('Bad request');
    return;
  }

  try {
    let stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      const dir = filePath;
      stat = null;
      for (const name of DIR_INDEX) {
        try {
          stat = await fs.stat(join(dir, name));
          filePath = join(dir, name);
          break;
        } catch { /* try the next candidate */ }
      }
      if (!stat) throw new Error('no index file in ' + dir);
    }

    const ext = extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';

    if (ext === '.html') {
      // inject the reload client just before </body> (or append if absent)
      let html = await fs.readFile(filePath, 'utf8');
      html = html.includes('</body>')
        ? html.replace('</body>', RELOAD_SNIPPET + '</body>')
        : html + RELOAD_SNIPPET;
      res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(html);
      return;
    }

    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': 'no-store',
    });
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 — not found: ' + (req.url || ''));
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is in use. Try: PORT=3001 npm run dev`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(
    `\n  Static site running at  http://localhost:${PORT}/` +
    `\n  Entry:   ${ENTRY}` +
    `\n  Serving: ${ROOT}` +
    `\n  Ctrl+C to stop.\n`
  );
});
