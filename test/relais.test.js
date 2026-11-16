// Le relais (relais/worker.js) utilise les API web standard : on peut l'exercer tel quel sous Node.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import relay from '../relais/worker.js';
import { startMock, VIDEO } from './mock-provider.js';

let mock;
const env = { CLE: 'ma-cle' };
const call = (query, init) => relay.fetch(new Request(`https://relais.example/?${query}`, init), env);
const via = (url, key = 'ma-cle') => `k=${encodeURIComponent(key)}&u=${encodeURIComponent(url)}`;

before(async () => { mock = await startMock(); });
after(() => { mock.server.close(); mock.server.closeAllConnections(); });

test('le relais exige sa clé', async () => {
  assert.equal((await relay.fetch(new Request('https://relais.example/?ping=1'), {})).status, 500, 'sans variable CLE, tout est refusé');
  assert.equal((await call('ping=1')).status, 403);
  assert.equal((await call(via(`${mock.origin}/playlist.m3u`, 'mauvaise'))).status, 403);
  const ok = await call('k=ma-cle&ping=1');
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, service: 'seance-relais', version: 2 });
  assert.equal(ok.headers.get('access-control-allow-origin'), '*');
});

test('le relais refuse les adresses invalides et les méthodes d\'écriture', async () => {
  assert.equal((await call('k=ma-cle')).status, 400);
  assert.equal((await call(via('ftp://exemple/fichier'))).status, 400);
  assert.equal((await call(via(`${mock.origin}/x`), { method: 'POST' })).status, 405);
  assert.equal((await call('', { method: 'OPTIONS' })).status, 204);
  const down = await call(via('http://127.0.0.1:9/'));
  assert.equal(down.status, 502);
});

test('le relais transmet l\'API Xtream et les vidéos avec Range', async () => {
  const api = await call(via(`${mock.origin}/player_api.php?username=demo&password=secret`));
  assert.equal(api.status, 200);
  assert.equal((await api.json()).user_info.auth, 1);

  const part = await call(via(`${mock.origin}/movie/demo/secret/1.mp4`), { headers: { Range: 'bytes=10-19' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 10-19/${VIDEO.length}`);
  assert.equal(part.headers.get('access-control-allow-origin'), '*');
  assert.ok(Buffer.from(await part.arrayBuffer()).equals(VIDEO.subarray(10, 20)));
});

test('le relais réécrit les playlists HLS mais pas les playlists de chaînes', async () => {
  const hls = await call(via(`${mock.origin}/live/demo/secret/101.m3u8`));
  const lines = (await hls.text()).split('\n');
  const seg = lines.find((l) => l.startsWith('https://relais.example/'));
  assert.ok(seg, 'le segment repasse par le relais');
  const inner = new URL(seg).searchParams;
  assert.equal(inner.get('k'), 'ma-cle');
  assert.equal(inner.get('u'), `${mock.origin}/edge/abc/seg1.ts`, 'adresse résolue après redirection');
  assert.equal(await (await call(seg.split('?')[1])).text(), 'SEGMENT-1');

  const channels = await (await call(via(`${mock.origin}/playlist.m3u`))).text();
  assert.match(channels, /#EXTINF:-1 tvg-id="a"/);
  assert.ok(!channels.includes('relais.example'), 'la liste de chaînes n\'est pas modifiée');
});

test('le relais contourne le refus des adresses IP et explique les refus de Cloudflare', async () => {
  const real = globalThis.fetch;
  const seen = [];
  const cf = (status, code) => new Response(`error code: ${code}`, { status, headers: { 'Content-Type': 'text/plain; charset=UTF-8' } });
  globalThis.fetch = async (href) => {
    const u = new URL(href);
    seen.push(u.host);
    if (/^\d+(\.\d+){3}$/.test(u.hostname)) return cf(403, 1003); // Cloudflare refuse les adresses IP nues
    if (u.hostname === '203.0.113.7.nip.io') return new Response('{"user_info":{"auth":1}}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    if (u.hostname === 'introuvable.example') return cf(530, 1016);
    if (u.hostname === 'refus.example') return new Response('<html>Forbidden</html>', { status: 403, headers: { 'Content-Type': 'text/html' } });
    return cf(403, 1003);
  };
  try {
    const ok = await call(via('http://203.0.113.7:8080/player_api.php?username=a&password=b'));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).user_info.auth, 1);
    assert.deepEqual(seen, ['203.0.113.7:8080', '203.0.113.7.nip.io:8080'], 'essai direct, puis par nom de domaine');

    seen.length = 0;
    await call(via('http://203.0.113.7:8080/live/a/b/1.ts'));
    assert.deepEqual(seen, ['203.0.113.7.nip.io:8080'], 'les appels suivants vont directement au nom qui fonctionne');

    const dns = await call(via('http://introuvable.example/player_api.php'));
    assert.equal(dns.status, 502);
    const body = await dns.json();
    assert.equal(body.cloudflare, 1016);
    assert.match(body.error, /1016/);

    const blocked = await call(via('http://198.51.100.9/player_api.php'));
    assert.equal((await blocked.json()).cloudflare, 1003, 'si le nom de domaine échoue aussi, la cause est indiquée');

    // Un refus qui vient du fournisseur lui-même est transmis tel quel.
    const refused = await call(via('http://refus.example/player_api.php'));
    assert.equal(refused.status, 403);
    assert.match(await refused.text(), /Forbidden/);
  } finally {
    globalThis.fetch = real;
  }
});
