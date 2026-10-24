import fs from 'node:fs/promises';
import { build, normalizePath } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
const folder = resolve('tmp/r4-func-01/browser');
await fs.mkdir(folder, { recursive: true });
await fs.writeFile(folder + '/index.html', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="root"></div><script type="module" src="/experiments/r4-func-01/browser-entry.jsx"></script></body></html>');
const output = await build({ configFile: false, envDir: folder, plugins: [{
  name: 'audit-service-boundary', enforce: 'pre',
  resolveId(id) { if (/(^|\/)supabase(?:\.ts)?$/.test(id)) return normalizePath(resolve('experiments/r4-func-01/browser-fixture.mjs')); },
}, react()], build: { write: false, rollupOptions: { input: folder + '/index.html' } } });
const files = new Map(output.output.map(file => [file.fileName, Buffer.from(file.type === 'asset' ? file.source : file.code)]));
for (const file of output.output) if (file.type === 'chunk' && Object.keys(file.modules).some(id => /supabase-js|auth-js|src\/lib\/supabase/.test(id))) throw Error('Real SDK leaked into fixture');
const html = [...files.keys()].find(name => name.endsWith('index.html'));
createServer((req, res) => {
  if (req.method !== 'GET') { res.writeHead(405); res.end(); return; }
  const path = new URL(req.url, 'http://localhost').pathname.slice(1);
  const key = path.startsWith('assets/') ? path : html;
  if (!files.has(key)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'none'; style-src 'self' 'unsafe-inline'; img-src 'none'; object-src 'none'");
  res.setHeader('Content-Type', key.endsWith('.js') ? 'text/javascript' : key.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(files.get(key));
}).listen(4188, '127.0.0.1', () => console.log('Synthetic app: http://127.0.0.1:4188'));
