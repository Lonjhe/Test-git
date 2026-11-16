// Persistance simple en fichiers JSON (configuration, état de lecture, caches).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DATA_DIR = path.resolve(process.env.SEANCE_DATA || path.join(ROOT, 'data'));

export class JsonFile {
  static all = [];

  constructor(name, defaults, { secret = false } = {}) {
    this.file = path.join(DATA_DIR, name);
    this.secret = secret;
    this.timer = null;
    this.data = defaults;
    JsonFile.all.push(this);
    try {
      this.data = { ...defaults, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn(`[store] ${name} illisible, valeurs par défaut utilisées :`, err.message);
    }
  }

  /** Écriture différée (regroupe les modifications rapprochées). */
  save(delay = 400) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
    this.timer.unref?.();
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: this.secret ? 0o600 : 0o644 });
    fs.renameSync(tmp, this.file);
  }
}

export const config = new JsonFile('config.json', { secret: '', sources: [], settings: { tmdbKey: '' } }, { secret: true });
if (!config.data.secret) {
  config.data.secret = crypto.randomBytes(24).toString('hex');
  config.flush();
}

// Favoris et progression de lecture, partagés entre tous les écrans de la maison.
export const userState = new JsonFile('state.json', { favorites: {}, progress: {} });

export function newId() {
  return crypto.randomBytes(3).toString('hex');
}

export function shortHash(s) {
  return crypto.createHash('sha1').update(s).digest('base64url').slice(0, 10);
}
