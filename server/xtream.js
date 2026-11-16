// Client Xtream côté serveur : celui du code partagé, avec un User-Agent réglable.
import { Xtream as Base } from '../shared/xtream.js';

export { normalizeBase, xtreamFromM3uUrl, asArray, b64 } from '../shared/xtream.js';

export const USER_AGENT = process.env.SEANCE_USER_AGENT || 'Mozilla/5.0 (Seance IPTV Player)';

export class Xtream extends Base {
  constructor(source) {
    super(source, { headers: { 'User-Agent': USER_AGENT } });
  }
}
