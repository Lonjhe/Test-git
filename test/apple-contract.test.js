// Le code Swift de apple/ ne peut pas être compilé ici : ce test vérifie au moins que les
// formats qu'il attend (apple/TV/Models.swift) sont bien ceux que renvoie le serveur.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-apple-'));
let app;
let base;
const get = async (p) => {
  const res = await fetch(base + p);
  return { status: res.status, data: await res.json().catch(() => null), res };
};

before(async () => {
  process.env.SEANCE_DATA = dataDir;
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.port}`;
  await fetch(`${base}/api/sources`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"type":"demo"}' });
  for (let i = 0; i < 200; i++) {
    if (!(await get('/api/status')).data.catalog.loading) break;
    await new Promise((r) => setTimeout(r, 25));
  }
});

after(() => {
  app?.server.close();
  app?.server.closeAllConnections();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

const type = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
/** Vérifie que `obj` a les champs `required` (types exacts) et, s'ils sont présents, ceux de `optional`. */
function shape(obj, required, optional = {}, label = '') {
  for (const [key, want] of Object.entries(required)) assert.equal(type(obj[key]), want, `${label}${key} doit être ${want}`);
  for (const [key, want] of Object.entries(optional)) if (key in obj) assert.equal(type(obj[key]), want, `${label}${key} doit être ${want}`);
}

test('statut : champs lus par StatusResponse', async () => {
  const { data } = await get('/api/status');
  shape(data, { configured: 'boolean', catalog: 'object' });
  shape(data.catalog, { loading: 'boolean', counts: 'object' });
  shape(data.catalog.counts, { movies: 'number', series: 'number', channels: 'number' });
});

test('catalogue : champs lus par Movie, Series et Channel', async () => {
  const { data } = await get('/api/catalog');
  shape(data, { movies: 'array', series: 'array', channels: 'array' });
  for (const m of data.movies) {
    shape(m, { id: 'string', title: 'string' }, { year: 'number', poster: 'string', backdrop: 'string', rating: 'number', added: 'number', cat: 'string', genres: 'array', quality: 'string', versions: 'array' }, 'film.');
    for (const v of m.versions || []) shape(v, { id: 'string', label: 'string' }, { quality: 'string' }, 'version.');
  }
  for (const s of data.series) shape(s, { id: 'string', title: 'string' }, { year: 'number', poster: 'string', backdrop: 'string', rating: 'number', added: 'number', cat: 'string', genres: 'array', plot: 'string' }, 'série.');
  for (const c of data.channels) shape(c, { id: 'string', name: 'string' }, { logo: 'string', cat: 'string', num: 'number' }, 'chaîne.');
  assert.ok(data.movies.length && data.series.length && data.channels.length);
});

test('fiches : champs lus par MovieDetail, SeriesDetail et Episode', async () => {
  const { data: cat } = await get('/api/catalog');
  const { data: movie } = await get(`/api/movie/${cat.movies[0].id}`);
  shape(movie, {}, { plot: 'string', tagline: 'string', duration: 'number', cast: 'array', director: 'string', genres: 'array', backdrop: 'string' }, 'détail film.');
  const { data: show } = await get(`/api/series/${cat.series[0].id}`);
  shape(show, { episodes: 'array' }, { plot: 'string', backdrop: 'string' }, 'détail série.');
  assert.ok(show.episodes.length);
  for (const e of show.episodes) shape(e, { id: 'string', season: 'number', episode: 'number' }, { title: 'string', plot: 'string', duration: 'number', image: 'string' }, 'épisode.');
});

test('lecture : champs lus par PlayInfo, dont la conversion HLS', async () => {
  const { data: cat } = await get('/api/catalog');
  const { data: film } = await get(`/api/play/${cat.movies[0].id}`);
  shape(film, { url: 'string', type: 'string' }, { ext: 'string', external: 'string', convert: 'string', convertHls: 'string', ffmpeg: 'boolean' }, 'lecture film.');
  assert.equal(film.ext, 'mp4');
  const { data: chaine } = await get(`/api/play/${cat.channels[0].id}`);
  shape(chaine, { url: 'string', type: 'string' }, {}, 'lecture chaîne.');
  assert.equal(chaine.type, 'hls');
  // Un identifiant inconnu doit renvoyer une erreur lisible : le client Swift en affiche le champ « error ».
  const missing = await get('/api/play/m-inconnu-1');
  assert.equal(missing.status, 404);
  assert.equal(type(missing.data.error), 'string');
});

test('état : favoris et progression, tels que lus (UserState) et écrits (Library)', async () => {
  const post = (p, body) => fetch(base + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // Mêmes champs, mêmes types que Library.saveProgress et toggleFavorite.
  assert.equal((await post('/api/state/favorite', { id: 'm-x-1', on: true })).status, 200);
  assert.equal((await post('/api/state/progress', { id: 'm-x-1', pos: 120, dur: 6000, done: false, kind: 'movie', title: 'T', sub: 'S', poster: 'P', parent: '', play: 'm-x-1' })).status, 200);
  const { data } = await get('/api/state');
  assert.equal(type(data.favorites['m-x-1']), 'number');
  shape(data.progress['m-x-1'], { pos: 'number', dur: 'number', ts: 'number', done: 'boolean', kind: 'string', title: 'string', sub: 'string', poster: 'string', parent: 'string', play: 'string' });
});

test('Séance se reconnaît elle-même : /api/status contient « catalog » (vérifié par ServerStore.connect)', async () => {
  const { status, data } = await get('/api/status');
  assert.equal(status, 200);
  assert.ok('catalog' in data);
});
