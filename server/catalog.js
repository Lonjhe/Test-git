// Catalogue côté serveur : la logique est partagée (shared/catalog.js) ; ici on
// fournit la lecture des sources (réseau, fichiers importés) et le cache sur disque.
import fs from 'node:fs';
import path from 'node:path';
import { Catalog as Base, xtreamData, m3uData } from '../shared/catalog.js';
import { Xtream, USER_AGENT } from './xtream.js';
import { loadDemo, demoEpg } from './demo.js';
import { JsonFile, DATA_DIR } from './store.js';

export { groupMovies } from '../shared/catalog.js';

async function m3uText(source) {
  if (source.file) return fs.readFileSync(path.join(DATA_DIR, path.basename(source.file)), 'utf8');
  const res = await fetch(source.url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(180_000) });
  if (!res.ok) throw new Error(`La playlist a répondu ${res.status}`);
  return res.text();
}

export class Catalog extends Base {
  constructor(config, { origin }) {
    super({
      config,
      cache: new JsonFile('cache/catalog.json', { catalog: null }, { secret: true }),
      xtream: (source) => new Xtream(source),
      demoEpg,
      async load(source, settings) {
        if (source.type === 'xtream') return xtreamData(new Xtream(source), settings);
        if (source.type === 'm3u') return m3uData(await m3uText(source));
        return loadDemo(origin());
      },
    });
  }
}
