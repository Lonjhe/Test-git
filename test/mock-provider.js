// Faux fournisseur IPTV (API Xtream + playlist M3U) et faux TMDB pour les tests.
import http from 'node:http';

const b64 = (s) => Buffer.from(s).toString('base64');
export const VIDEO = Buffer.from(Array.from({ length: 4096 }, (_, i) => i % 251));

const VOD = [
  { stream_id: 1, name: 'FR - Heat (1995)', stream_icon: 'http://img/heat.jpg', rating: '8.3', added: '1700000000', category_id: '10', container_extension: 'mkv' },
  { stream_id: 2, name: 'FR - Heat (1995) 4K HDR', stream_icon: '', rating_5based: 4.1, added: '1700000500', category_id: '10', container_extension: 'mp4' },
  { stream_id: 3, name: 'Alien (1979)', stream_icon: '', rating: '8.5', added: '1690000000', category_id: '11', container_extension: 'mp4' },
  { stream_id: 4, name: 'Aliens (1986)', stream_icon: '', rating: '8.4', added: '1690000001', category_id: '11', container_extension: 'mp4' },
  { stream_id: 5, name: 'Film interdit', stream_icon: '', rating: '5', added: '1', category_id: '12', container_extension: 'mp4' },
];

export function startMock() {
  const hits = { tmdbSearch: 0 };
  const picky = { on: false }; // quand il est actif, seuls les lecteurs « VLC » sont acceptés
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://mock');
    const json = (body, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
    const q = url.searchParams;
    if (picky.on && !url.pathname.startsWith('/3/') && !/VLC/.test(req.headers['user-agent'] || '')) { res.writeHead(512); return res.end('blocked'); }

    if (url.pathname === '/player_api.php') {
      if (q.get('username') !== 'demo' || q.get('password') !== 'secret') return json({ user_info: { auth: 0 } });
      switch (q.get('action')) {
        case null: return json({ user_info: { auth: 1, status: 'Active', exp_date: '1900000000', max_connections: '2', active_cons: '0' }, server_info: {} });
        case 'get_live_categories': return json([{ category_id: '1', category_name: 'FR | GENERALISTES' }, { category_id: '2', category_name: 'XXX ADULTES' }]);
        case 'get_live_streams': return json([
          { num: 1, name: 'Chaîne Une', stream_id: 101, stream_icon: 'http://img/1.png', epg_channel_id: 'une.fr', category_id: '1' },
          { num: 2, name: 'Chaîne Rose', stream_id: 102, stream_icon: '', epg_channel_id: '', category_id: '2' },
        ]);
        case 'get_vod_categories': return json([{ category_id: '10', category_name: 'FR | ACTION' }, { category_id: '11', category_name: 'SCIENCE-FICTION / HORREUR' }, { category_id: '12', category_name: 'ADULTES XXX' }]);
        case 'get_vod_streams': return json(VOD);
        case 'get_series_categories': return json([{ category_id: '20', category_name: 'Séries Drame' }]);
        case 'get_series': return json([{ series_id: 7, name: 'Dark (2017)', cover: 'http://img/dark.jpg', plot: 'Une disparition.', genre: 'Drama, Mystery', releaseDate: '2017-12-01', rating: '8.7', backdrop_path: ['http://img/dark-bg.jpg'], last_modified: '1700000000', category_id: '20' }]);
        case 'get_vod_info': return json({ info: { plot: 'Un braquage tourne mal.', genre: 'Crime, Thriller', cast: 'Al Pacino, Robert De Niro', director: 'Michael Mann', duration_secs: 10200, backdrop_path: ['http://img/heat-bg.jpg'], tmdb_id: '949', youtube_trailer: 'abcdefghijk' }, movie_data: {} });
        case 'get_series_info': return json({ info: { plot: 'Quatre familles.', cast: 'Louis Hofmann', director: 'Baran bo Odar' }, episodes: { 1: [
          { id: '501', episode_num: 1, title: 'Dark - S01E01 - Secrets', container_extension: 'mkv', season: 1, info: { duration_secs: 3000, plot: 'Début.', movie_image: 'http://img/e1.jpg' } },
          { id: '502', episode_num: 2, title: 'Dark - S01E02 - Mensonges', container_extension: 'mkv', season: 1, info: { duration: '00:45:00' } },
        ] } });
        case 'get_short_epg': return json({ epg_listings: [
          { title: b64('Le Journal'), description: b64('Actualités'), start_timestamp: String(Math.floor(Date.now() / 1000) - 600), stop_timestamp: String(Math.floor(Date.now() / 1000) + 1200) },
        ] });
        default: return json([]);
      }
    }

    if (/^\/(movie|series)\/demo\/secret\/\d+\.(mp4|mkv)$/.test(url.pathname)) {
      const m = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
      if (m) {
        const start = +m[1];
        const end = m[2] ? +m[2] : VIDEO.length - 1;
        res.writeHead(206, { 'Content-Type': 'application/octet-stream', 'Content-Range': `bytes ${start}-${end}/${VIDEO.length}`, 'Content-Length': end - start + 1, 'Accept-Ranges': 'bytes' });
        return res.end(VIDEO.subarray(start, end + 1));
      }
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': VIDEO.length, 'Accept-Ranges': 'bytes' });
      return res.end(VIDEO);
    }
    if (url.pathname === '/live/demo/secret/101.m3u8') {
      // Le vrai flux est souvent servi après une redirection vers un autre chemin.
      res.writeHead(302, { Location: '/edge/abc/index.m3u8' });
      return res.end();
    }
    if (url.pathname === '/edge/abc/index.m3u8') {
      res.writeHead(200, { 'Content-Type': 'application/vnd.apple.mpegurl' });
      return res.end('#EXTM3U\n#EXT-X-TARGETDURATION:4\n#EXTINF:4,\nseg1.ts\n#EXT-X-ENDLIST\n');
    }
    if (url.pathname === '/edge/abc/seg1.ts') {
      res.writeHead(200, { 'Content-Type': 'video/mp2t' });
      return res.end('SEGMENT-1');
    }
    if (url.pathname === '/playlist.m3u') {
      res.writeHead(200, { 'Content-Type': 'audio/x-mpegurl' });
      return res.end([
        '#EXTM3U',
        '#EXTINF:-1 tvg-id="a" tvg-logo="http://img/a.png" group-title="Info",Canal A',
        `http://${req.headers.host}/edge/abc/index.m3u8`,
        '#EXTINF:-1 group-title="Films Comédie",Le Dîner (1998)',
        `http://${req.headers.host}/movie/demo/secret/9.mp4`,
        '#EXTINF:-1 group-title="Séries",Kaamelott S01 E01',
        `http://${req.headers.host}/series/demo/secret/70.mp4`,
        '#EXTINF:-1 group-title="Séries",Kaamelott S01 E02',
        `http://${req.headers.host}/series/demo/secret/71.mp4`,
      ].join('\n'));
    }

    // ——— Faux TMDB ———
    if (url.pathname.startsWith('/3/')) {
      if (q.get('api_key') !== 'tmdb-ok') return json({ status_message: 'Invalid API key' }, 401);
      const p = url.pathname.slice(2);
      if (p === '/configuration') return json({ images: {} });
      if (p === '/genre/movie/list') return json({ genres: [{ id: 80, name: 'Crime' }, { id: 53, name: 'Thriller' }, { id: 878, name: 'Science-Fiction' }, { id: 27, name: 'Horreur' }] });
      if (p === '/search/movie') {
        hits.tmdbSearch++;
        const title = (q.get('query') || '').toLowerCase();
        const db = {
          heat: { id: 949, title: 'Heat', genre_ids: [80, 53], backdrop_path: '/heat.jpg', poster_path: '/heat-p.jpg', vote_average: 7.9, vote_count: 6000, release_date: '1995-12-15' },
          alien: { id: 348, title: 'Alien', genre_ids: [27, 878], backdrop_path: '/alien.jpg', vote_average: 8.1, vote_count: 9000, release_date: '1979-05-25' },
          aliens: { id: 679, title: 'Aliens', genre_ids: [878], backdrop_path: '/aliens.jpg', vote_average: 7.9, vote_count: 8000, release_date: '1986-07-18' },
        };
        return json({ results: db[title] ? [db[title]] : [] });
      }
      if (p === '/movie/949') {
        return json({ id: 949, overview: 'Un flic, un braqueur, Los Angeles.', runtime: 170, genres: [{ id: 80, name: 'Crime' }], vote_average: 7.9, vote_count: 6000,
          credits: { cast: [{ name: 'Al Pacino' }], crew: [{ job: 'Director', name: 'Michael Mann' }] },
          recommendations: { results: [{ id: 348 }] }, similar: { results: [{ id: 679 }, { id: 348 }] }, videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'TRAILERKEY1' }] } });
      }
      return json({}, 404);
    }
    res.writeHead(404);
    res.end();
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, hits, picky, origin: `http://127.0.0.1:${server.address().port}` }));
  });
}
