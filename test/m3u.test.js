import test from 'node:test';
import assert from 'node:assert/strict';
import { parseM3u, classifyEntry, playbackType } from '../server/m3u.js';
import { xtreamFromM3uUrl } from '../server/xtream.js';

const SAMPLE = `#EXTM3U
#EXTINF:-1 tvg-id="tf1.fr" tvg-name="TF1" tvg-logo="http://logo/tf1.png" group-title="Généralistes",TF1 HD
http://host/live/u/p/1.ts
#EXTINF:-1 tvg-logo="http://img/a.jpg" group-title="Films, Action",Heat (1995)
http://host/movie/u/p/22.mkv
#EXTINF:-1 group-title="Séries",Dark S01 E02
http://host/series/u/p/33.mp4

#EXTINF:-1,Sans attributs
http://autre/flux.m3u8
#EXTINF:-1,Ligne orpheline
# commentaire
`;

test('parseM3u lit attributs, noms et adresses', () => {
  const e = parseM3u(SAMPLE);
  assert.equal(e.length, 4);
  assert.deepEqual(e[0], { name: 'TF1 HD', logo: 'http://logo/tf1.png', group: 'Généralistes', epgId: 'tf1.fr', url: 'http://host/live/u/p/1.ts' });
  assert.equal(e[1].group, 'Films, Action');
  assert.equal(e[1].name, 'Heat (1995)');
  assert.equal(e[3].name, 'Sans attributs');
});

test('classifyEntry distingue direct, films et épisodes', () => {
  const kinds = parseM3u(SAMPLE).map(classifyEntry);
  assert.deepEqual(kinds, ['live', 'movie', 'episode', 'live']);
  assert.equal(classifyEntry({ name: 'Show S02E03', url: 'http://x/y/file.mkv' }), 'episode');
  assert.equal(classifyEntry({ name: 'Un film', url: 'http://x/y/file.mp4?token=1' }), 'movie');
});

test('playbackType choisit le bon lecteur', () => {
  assert.equal(playbackType('http://h/live/u/p/1.m3u8', 'live'), 'hls');
  assert.equal(playbackType('http://h/live/u/p/1.ts', 'live'), 'mpegts');
  assert.equal(playbackType('http://h/live/u/p/1', 'live'), 'mpegts');
  assert.equal(playbackType('http://h/movie/u/p/1.mkv', 'movie'), 'file');
});

test('un lien get.php est reconnu comme compte Xtream', () => {
  assert.deepEqual(xtreamFromM3uUrl('http://tv.example:8080/get.php?username=bob&password=s3cret&type=m3u_plus'),
    { url: 'http://tv.example:8080', username: 'bob', password: 's3cret' });
  assert.equal(xtreamFromM3uUrl('http://tv.example/playlist.m3u'), null);
});
