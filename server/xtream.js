// Client Xtream côté serveur : celui du code partagé, avec un User-Agent réglable.
import { Xtream as Base } from '../shared/xtream.js';

export { normalizeBase, xtreamFromM3uUrl, asArray, b64 } from '../shared/xtream.js';

export const USER_AGENT = process.env.SEANCE_USER_AGENT || 'Mozilla/5.0 (Seance IPTV Player)';

// Certains fournisseurs n'acceptent que des lecteurs qu'ils connaissent : si le nom
// par défaut est refusé, on se présente sous l'un de ces noms courants.
const KNOWN_PLAYERS = ['VLC/3.0.20 LibVLC/3.0.20', 'IPTVSmartersPro', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'];

/** Nom sous lequel se présenter à une source (celui qui a fonctionné, sinon le nom par défaut). */
export const userAgentFor = (source) => source?.userAgent || USER_AGENT;

export class Xtream extends Base {
  constructor(source) {
    super(source, { headers: { 'User-Agent': userAgentFor(source) } });
  }
}

/**
 * Vérifie le compte. Si le fournisseur renvoie une erreur HTTP (et non un refus des
 * identifiants), réessaie sous d'autres noms de lecteur et mémorise celui qui passe
 * dans source.userAgent.
 */
export async function connect(source) {
  try {
    return await new Xtream(source).account();
  } catch (first) {
    if (!first.status) throw first;
    for (const userAgent of KNOWN_PLAYERS) {
      if (userAgent === userAgentFor(source)) continue;
      try {
        const account = await new Xtream({ ...source, userAgent }).account();
        source.userAgent = userAgent;
        return account;
      } catch (err) {
        if (err.refused) throw err;
      }
    }
    throw first;
  }
}
