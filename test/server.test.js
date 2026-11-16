// Test d'intégration : le serveur Séance face à un faux fournisseur Xtream / M3U et un faux TMDB.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { startMock, VIDEO } from './mock-provider.js';

let ffmpegInstalled = true;
try { execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' }); execFileSync('ffprobe', ['-version'], { stdio: 'ignore' }); } catch { ffmpegInstalled = false; }

let mock;
let app;
let base;
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seance-test-'));

const call = async (method, p, body) => {
  const res = await fetch(base + p, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  return { status: res.status, data: await res.json().catch(() => null) };
};
const get = (p) => call('GET', p);
async function settled(check = (s) => !s.catalog.loading) {
  for (let i = 0; i < 200; i++) {
    const { data } = await get('/api/status');
    if (check(data)) return data;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('délai dépassé');
}

before(async () => {
  mock = await startMock();
  process.env.SEANCE_DATA = dataDir;
  process.env.TMDB_BASE_URL = `${mock.origin}/3`;
  const { startServer } = await import('../server/index.js');
  app = await startServer({ port: 0, host: '127.0.0.1' });
  base = `http://127.0.0.1:${app.port}`;
});

after(() => {
  app?.server.close();
  app?.server.closeAllConnections();
  mock?.server.close();
  mock?.server.closeAllConnections();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test('au départ rien n\'est configuré', async () => {
  const { data } = await get('/api/status');
  assert.equal(data.configured, false);
  assert.deepEqual((await get('/api/catalog')).data.movies, []);
});

test('des identifiants Xtream erronés sont refusés', async () => {
  const r = await call('POST', '/api/sources', { type: 'xtream', url: mock.origin, username: 'demo', password: 'faux' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Identifiants refusés/);
  assert.equal((await get('/api/status')).data.configured, false);
});

test('les requêtes de modification exigent du JSON (protection CSRF)', async () => {
  const res = await fetch(`${base}/api/sources`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{"type":"demo"}' });
  assert.equal(res.status, 415);
});

test('ajout d\'un compte Xtream : catalogue nettoyé, versions regroupées, adultes masqués', async () => {
  const r = await call('POST', '/api/sources', { type: 'xtream', url: mock.origin, username: 'demo', password: 'secret', name: 'Test' });
  assert.equal(r.status, 200);
  const status = await settled();
  assert.deepEqual(status.catalog.counts, { movies: 3, series: 1, channels: 1 });
  assert.equal(status.sources[0].account.maxConnections, 2);
  assert.ok(!JSON.stringify(status).includes('secret'), 'le mot de passe n\'est jamais renvoyé');

  const { data: cat } = await get('/api/catalog');
  assert.ok(!JSON.stringify(cat).includes('secret'), 'aucune adresse de flux dans le catalogue');
  const heat = cat.movies.find((m) => m.title === 'Heat');
  assert.equal(heat.year, 1995);
  assert.equal(heat.versions.length, 2);
  assert.equal(heat.rating, 8.3);
  assert.deepEqual(heat.genres, ['Action']);
  assert.equal(heat.cat, 'Action');
  assert.deepEqual(cat.movies.find((m) => m.title === 'Alien').genres, ['Science-Fiction', 'Horreur']);
  assert.ok(!cat.movies.some((m) => m.title === 'Film interdit'));
  assert.deepEqual(cat.channels.map((c) => c.name), ['Chaîne Une']);
  assert.equal(cat.channels[0].cat, 'Generalistes');
  assert.deepEqual(cat.series[0].genres, ['Drame', 'Mystère']);
  assert.equal(cat.series[0].title, 'Dark');
});

test('fiche film, fiche série et programme TV', async () => {
  const { data: cat } = await get('/api/catalog');
  const heat = cat.movies.find((m) => m.title === 'Heat');
  const { data: d } = await get(`/api/movie/${heat.id}`);
  assert.equal(d.plot, 'Un braquage tourne mal.');
  assert.equal(d.duration, 170);
  assert.equal(d.director, 'Michael Mann');
  assert.deepEqual(d.cast, ['Al Pacino', 'Robert De Niro']);
  assert.equal(d.tmdb, 949);

  const { data: s } = await get(`/api/series/${cat.series[0].id}`);
  assert.equal(s.episodes.length, 2);
  assert.equal(s.episodes[0].title, 'Secrets');
  assert.equal(s.episodes[0].duration, 50);
  assert.equal(s.episodes[1].duration, 45);
  assert.match(s.episodes[0].id, /^e-[^-]+-x501\.mkv$/);

  const { data: epg } = await get(`/api/epg/${cat.channels[0].id}`);
  assert.equal(epg[0].title, 'Le Journal');
  assert.equal((await get('/api/movie/m-xx-999')).status, 404);
});

test('le relais sert les films (avec Range) et les épisodes', async () => {
  const { data: cat } = await get('/api/catalog');
  const heat = cat.movies.find((m) => m.title === 'Heat');
  const { data: play } = await get(`/api/play/${heat.versions[1].id}`);
  assert.equal(play.type, 'file');

  const full = await fetch(base + play.url);
  assert.equal(full.status, 200);
  assert.ok(Buffer.from(await full.arrayBuffer()).equals(VIDEO));
  assert.match(full.headers.get('content-type'), /^video\//, 'le type générique est corrigé d\'après l\'extension');

  const part = await fetch(base + play.url, { headers: { Range: 'bytes=100-199' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 100-199/${VIDEO.length}`);
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(VIDEO.subarray(100, 200)));

  const { data: s } = await get(`/api/series/${cat.series[0].id}`);
  const ep = await fetch(`${base}/stream/${s.episodes[0].id}`, { headers: { Range: 'bytes=0-9' } });
  assert.equal(ep.status, 206);
  assert.equal((await fetch(`${base}/stream/m-xx-1`)).status, 404);
});

test('le direct HLS est réécrit et ses segments passent par des liens signés', async () => {
  const { data: cat } = await get('/api/catalog');
  const { data: play } = await get(`/api/play/${cat.channels[0].id}`);
  assert.equal(play.type, 'hls');
  assert.deepEqual(play.alt.type, 'mpegts');
  const manifest = await (await fetch(base + play.url)).text();
  const seg = manifest.split('\n').find((l) => l.startsWith('/hls?'));
  assert.ok(seg, 'le segment pointe vers le relais');
  assert.ok(!manifest.includes('127.0.0.1'), 'aucune adresse du fournisseur ne fuit');
  assert.equal(await (await fetch(base + seg)).text(), 'SEGMENT-1');
  assert.equal((await fetch(base + seg.replace(/s=.{4}/, 's=AAAA'))).status, 403);
  const forged = `/hls?u=${Buffer.from('http://127.0.0.1:1/x').toString('base64url')}&s=${new URL(seg, base).searchParams.get('s')}`;
  assert.equal((await fetch(base + forged)).status, 403, 'le relais n\'est pas un proxy ouvert');
});

test('favoris et progression de lecture', async () => {
  await call('POST', '/api/state/favorite', { id: 'm-a-1', on: true });
  await call('POST', '/api/state/progress', { id: 'm-a-1', pos: 120, dur: 6000, kind: 'movie', title: 'Heat' });
  let { data } = await get('/api/state');
  assert.ok(data.favorites['m-a-1']);
  assert.equal(data.progress['m-a-1'].pos, 120);
  assert.equal(data.progress['m-a-1'].done, false);
  await call('POST', '/api/state/favorite', { id: 'm-a-1', on: false });
  await call('POST', '/api/state/progress', { id: 'm-a-1', remove: true });
  ({ data } = await get('/api/state'));
  assert.deepEqual(data, { favorites: {}, progress: {} });
  assert.equal((await call('POST', '/api/state/favorite', {})).status, 400);
});

test('TMDB : clé invalide refusée, puis genres précis et recommandations', async () => {
  const bad = await call('PUT', '/api/settings', { tmdbKey: 'mauvaise' });
  assert.equal(bad.status, 400);
  assert.equal((await get('/api/status')).data.settings.tmdb, false);

  assert.equal((await call('PUT', '/api/settings', { tmdbKey: 'tmdb-ok' })).status, 200);
  const status = await settled((s) => s.enrichment.total === 3 && !s.enrichment.running);
  assert.equal(status.enrichment.done, 3);
  assert.equal(status.enrichment.error, '');

  const { data: cat } = await get('/api/catalog');
  const heat = cat.movies.find((m) => m.title === 'Heat');
  assert.deepEqual(heat.genres, ['Crime', 'Thriller']);
  assert.equal(heat.tmdb, 949);
  assert.match(heat.backdrop, /image\.tmdb\.org.*heat\.jpg$/);
  assert.equal(heat.poster, 'http://img/heat.jpg', 'l\'affiche du fournisseur est conservée');
  assert.deepEqual(cat.movies.find((m) => m.title === 'Alien').genres, ['Horreur', 'Science-Fiction']);

  const { data: d } = await get(`/api/movie/${heat.id}`);
  assert.equal(d.plot, 'Un flic, un braqueur, Los Angeles.');
  assert.equal(d.trailer, 'TRAILERKEY1');
  assert.deepEqual(d.recTmdbIds, [348, 679]);

  // Un second passage ne réinterroge pas TMDB : les correspondances sont en cache.
  const before = mock.hits.tmdbSearch;
  await call('POST', '/api/refresh');
  await settled((s) => !s.catalog.loading && !s.enrichment.running);
  assert.equal(mock.hits.tmdbSearch, before);
});

test('playlist M3U : chaînes, films et séries reconstituées ; lien get.php converti', async () => {
  const bad = await call('POST', '/api/sources', { type: 'm3u', url: `${mock.origin}/absent.m3u` });
  assert.equal(bad.status, 400);

  assert.equal((await call('POST', '/api/sources', { type: 'm3u', url: `${mock.origin}/playlist.m3u`, name: 'Liste' })).status, 200);
  const status = await settled();
  assert.deepEqual(status.catalog.counts, { movies: 4, series: 2, channels: 2 });
  const { data: cat } = await get('/api/catalog');
  const diner = cat.movies.find((m) => m.title === 'Le Dîner');
  assert.equal(diner.year, 1998);
  assert.deepEqual(diner.genres, ['Comédie']);
  const kaamelott = cat.series.find((s) => s.title === 'Kaamelott');
  const { data: s } = await get(`/api/series/${kaamelott.id}`);
  assert.deepEqual(s.episodes.map((e) => [e.season, e.episode]), [[1, 1], [1, 2]]);
  assert.equal((await fetch(`${base}/stream/${s.episodes[1].id}`, { headers: { Range: 'bytes=0-0' } })).status, 206);

  const viaUpload = await call('POST', '/api/sources', { type: 'm3u', content: '#EXTM3U\n#EXTINF:-1,Canal B\nhttp://exemple.invalid/b.m3u8\n', name: 'Fichier' });
  assert.equal(viaUpload.status, 200);
  assert.equal((await settled()).catalog.counts.channels, 3);

  const sources = (await get('/api/status')).data.sources;
  assert.equal((await call('DELETE', `/api/sources/${sources.find((x) => x.name === 'Fichier').id}`)).status, 200);
  assert.equal((await settled((st) => !st.catalog.loading && st.sources.length === 2)).catalog.counts.channels, 2);

  const converted = await call('POST', '/api/sources', { type: 'm3u', url: `${mock.origin}/get.php?username=demo&password=secret&type=m3u_plus` });
  assert.equal(converted.status, 200);
  assert.equal((await get('/api/status')).data.sources.at(-1).type, 'xtream');
});

test('un fournisseur qui filtre les lecteurs : Séance trouve le nom accepté et le garde pour les flux', async () => {
  mock.picky.on = true;
  try {
    const r = await call('POST', '/api/sources', { type: 'xtream', url: mock.origin.replace('127.0.0.1', 'localhost'), username: 'demo', password: 'secret', name: 'Difficile' });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const status = await settled();
    assert.ok(!status.catalog.warnings.some((w) => w.startsWith('Difficile')), status.catalog.warnings.join(' | '));
    const { data: cat } = await get('/api/catalog');
    const movie = cat.movies.flatMap((m) => m.versions || [m]).find((v) => v.id.startsWith(`m-${r.data.id}-`));
    const film = await fetch(`${base}/stream/${movie.id}`, { headers: { Range: 'bytes=0-9' } });
    assert.equal(film.status, 206, 'le film passe avec le nom de lecteur mémorisé');
    const channel = cat.channels.find((c) => c.id.startsWith(`c-${r.data.id}-`));
    const manifest = await (await fetch(`${base}/stream/${channel.id}`)).text();
    const seg = manifest.split('\n').find((l) => l.startsWith('/hls?'));
    assert.match(seg, /&src=/);
    assert.equal(await (await fetch(base + seg)).text(), 'SEGMENT-1', 'les segments HLS aussi');
    const bad = await call('POST', '/api/sources', { type: 'xtream', url: mock.origin, username: 'demo', password: 'faux' });
    assert.match(bad.data.error, /Identifiants refusés/);
  } finally {
    mock.picky.on = false;
  }
});

test('fichiers statiques : pas de sortie du dossier public', async () => {
  assert.equal((await fetch(`${base}/`)).status, 200);
  assert.equal((await fetch(`${base}/shared/text.js`)).status, 200);
  assert.equal((await fetch(`${base}/vendor/hls.min.js`)).status, 200);
  const res = await fetch(`${base}/%2e%2e/package.json`);
  assert.notEqual(res.status, 200);
  assert.equal((await fetch(`${base}/..%2Fdata%2Fconfig.json`)).status, 403);
});

test('conversion à la volée avec ffmpeg', { skip: !ffmpegInstalled && 'ffmpeg absent' }, async () => {
  assert.equal((await call('POST', '/api/sources', { type: 'demo' })).status, 200);
  await settled();
  const { data: cat } = await get('/api/catalog');
  const film = cat.movies.find((m) => m.id.startsWith('m-demo-'));
  const { data: play } = await get(`/api/play/${film.id}`);
  assert.equal(play.ffmpeg, true);
  assert.equal(play.convert, `/convert/${film.id}`);
  const { data: info } = await get(`/api/probe/${film.id}`);
  assert.equal(info.duration, 40);
  assert.equal(info.video, 'h264');

  const res = await fetch(`${base}${play.convert}?t=10`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(4, 8).toString(), 'ftyp', 'le résultat est bien un MP4');
  assert.ok(bytes.includes(Buffer.from('moof')), 'MP4 fragmenté, lisible au fil de l\'eau');
  assert.ok(bytes.length > 50_000);

  const channel = cat.channels.find((c) => c.id.startsWith('c-demo-'));
  assert.equal((await get(`/api/play/${channel.id}`)).data.convert, undefined, 'pas de conversion pour le direct');
  assert.equal((await fetch(`${base}/convert/m-xx-1`)).status, 404);
});
