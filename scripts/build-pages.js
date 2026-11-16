// Construit la démonstration statique de Séance (pour GitHub Pages) dans dist/.
//
// Le script lance le vrai serveur avec la source « Démonstration », puis
// enregistre ce que son API répond : l'interface statique lit ces fichiers à la
// place du serveur (voir public/js/api.js). Usage : npm run build:pages
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-pages-'));
process.env.SEANCE_DATA = tmp;

const { startServer } = await import('../server/index.js');
const { demoArt } = await import('../server/demo.js');
const app = await startServer({ port: 0, host: '127.0.0.1' });
const base = `http://127.0.0.1:${app.port}`;

const api = async (p, init) => {
  const res = await fetch(base + p, init);
  if (!res.ok) throw new Error(`${p} → ${res.status}`);
  return res.json();
};
const write = (rel, content) => {
  const file = path.join(dist, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
};

// Les affiches sont générées à la demande par le serveur ; ici on les fige en fichiers.
let artCount = 0;
const seenArt = new Set();
function freezeArt(json) {
  return json.replace(/\/demo\/art\/(\d+)\.svg\?shape=(\w+)&t=([^"\\]*)/g, (_, seed, shape, title) => {
    const rel = `demo/art/${seed}-${shape}.svg`;
    if (!seenArt.has(rel)) {
      seenArt.add(rel);
      artCount++;
      write(rel, demoArt(+seed, decodeURIComponent(title), shape));
    }
    return rel;
  });
}
const writeJson = (rel, data) => write(rel, freezeArt(JSON.stringify(data)));

try {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
  fs.cpSync(path.join(root, 'shared'), path.join(dist, 'shared'), { recursive: true });
  fs.cpSync(path.join(root, 'server', 'demo-media'), path.join(dist, 'demo', 'media'), { recursive: true });
  fs.cpSync(path.join(root, 'node_modules/hls.js/dist/hls.min.js'), path.join(dist, 'vendor/hls.min.js'));
  fs.cpSync(path.join(root, 'node_modules/mpegts.js/dist/mpegts.js'), path.join(dist, 'vendor/mpegts.js'));
  write('.nojekyll', '');

  const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
  const marked = html.replace('<title>', '<meta name="seance-static" content="1">\n  <title>');
  if (marked === html) throw new Error('index.html : balise <title> introuvable');
  write('index.html', marked);

  await api('/api/sources', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'demo' }) });
  let status;
  do {
    await new Promise((r) => setTimeout(r, 50));
    status = await api('/api/status');
  } while (status.catalog.loading);

  const catalog = await api('/api/catalog');
  writeJson('api/status.json', status);
  writeJson('api/catalog.json', catalog);
  for (const m of catalog.movies) writeJson(`api/movie/${m.id}.json`, await api(`/api/movie/${m.id}`));
  for (const s of catalog.series) writeJson(`api/series/${s.id}.json`, await api(`/api/series/${s.id}`));
  for (const c of catalog.channels) writeJson(`api/epg/${c.id}.json`, await api(`/api/epg/${c.id}`));

  const size = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile()).reduce((n, e) => n + fs.statSync(path.join(e.parentPath ?? e.path, e.name)).size, 0);
  console.log(`dist/ prêt : ${catalog.movies.length} films, ${catalog.series.length} séries, ${catalog.channels.length} chaînes, `
    + `${artCount} illustrations, ${(size(dist) / 1e6).toFixed(1)} Mo`);
} finally {
  app.server.close();
  app.server.closeAllConnections();
  fs.rmSync(tmp, { recursive: true, force: true });
}
