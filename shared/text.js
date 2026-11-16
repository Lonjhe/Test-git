// Outils de texte partagés entre le serveur et l'interface :
// nettoyage des titres IPTV, détection qualité/langue, genres canoniques.

export function fold(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Clé de comparaison : minuscules, sans accents ni ponctuation. */
export function normKey(s) {
  return fold(s)
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const LANG_TAGS = {
  vostfr: 'VOSTFR', vost: 'VOST', multi: 'MULTI', truefrench: 'VF', french: 'VF',
  vff: 'VF', vfq: 'VFQ', vf: 'VF', vfi: 'VF', vo: 'VO',
};
const COUNTRY_PREFIX = new Set([
  'FR', 'EN', 'US', 'UK', 'DE', 'ES', 'IT', 'PT', 'NL', 'BE', 'CA', 'AR', 'TR', 'PL', 'RU',
  'BR', 'IN', 'GR', 'RO', 'SE', 'DK', 'NO', 'FI', 'CH', 'AT', 'AF', 'ALB', 'EX', 'MA', 'DZ', 'TN',
]);
const PREFIX_TAGS = new Set(['VOD', '4K', 'UHD', 'FHD', 'HD', 'SD', 'HEVC', 'VOSTFR', 'MULTI', 'VF', 'VO', 'NF', 'TOP']);

const QUALITY_PATTERNS = [
  [/\b(?:4k|uhd|2160p?)\b/i, '4K'],
  [/\b(?:fhd|1080p?)\b/i, 'FHD'],
  [/\b(?:hd|720p?)\b/i, 'HD'],
  [/\b(?:sd|480p?|576p?)\b/i, 'SD'],
  [/\b(?:cam|hdcam|hdts|telesync)\b/i, 'CAM'],
];
const NOISE = /\b(?:hdr10\+?|hdr|dolby ?vision|dv|hevc|x265|h265|x264|h264|bluray|blu-ray|bdrip|brrip|web-?dl|webrip|hdrip|dvdrip|hdlight|light|atmos|ac3|dts|aac|10bit|remux|extended|unrated|imax|low|raw)\b/gi;

/**
 * Découpe un nom de flux IPTV (« FR - Inception (2010) [4K HDR] ») en
 * titre propre, année, qualité et langue.
 */
export function parseTitle(raw) {
  let s = String(raw ?? '').replace(/[​-‏﻿]/g, '').replace(/[_]+/g, ' ').trim();
  let lang = '';
  let quality = '';
  let hdr = false;

  // Préfixes : « FR - », « |FR| », « [EN] », « 4K-FR : »…
  for (let i = 0; i < 3; i++) {
    const m = s.match(/^\s*(?:[\[|(]\s*([A-Za-z0-9+ -]{2,10}?)\s*[\]|)]\s*[-:|]*|([A-Z0-9]{2,6}(?:[- ][A-Z0-9]{2,6})?)\s*(?:[-:|]\s+|[:|]))\s*/);
    if (!m) break;
    const parts = (m[1] || m[2]).toUpperCase().split(/[\s-]+/).filter(Boolean);
    if (!parts.length || !parts.every((p) => COUNTRY_PREFIX.has(p) || PREFIX_TAGS.has(p))) break;
    const rest = s.slice(m[0].length).trim();
    if (!rest) break;
    for (const p of parts) {
      if (COUNTRY_PREFIX.has(p) && !lang) lang = p;
      else if (LANG_TAGS[p.toLowerCase()]) lang = LANG_TAGS[p.toLowerCase()];
    }
    if (/\b(?:4K|UHD)\b/.test(parts.join(' '))) quality = '4K';
    s = rest;
  }

  if (/\b(?:hdr10\+?|hdr|dolby ?vision)\b/i.test(s)) hdr = true;
  for (const [re, q] of QUALITY_PATTERNS) {
    if (re.test(s)) { quality = quality || q; break; }
  }
  const langMatch = s.match(/\b(vostfr|vost|multi|truefrench|french|vff|vfq|vfi|vf|vo)\b/i);
  if (langMatch) lang = LANG_TAGS[langMatch[1].toLowerCase()];

  // Année : entre parenthèses/crochets d'abord, sinon en fin de nom.
  let year = 0;
  const paren = [...s.matchAll(/[(\[]\s*((?:19|20)\d{2})\s*[)\]]/g)].pop();
  if (paren) {
    year = +paren[1];
    s = s.slice(0, paren.index) + ' ' + s.slice(paren.index + paren[0].length);
  }

  // Retire les marqueurs techniques, puis les crochets/parenthèses vidés.
  s = s
    .replace(NOISE, ' ')
    .replace(/\b(?:4k|uhd|2160p?|fhd|1080p?|720p?|480p?|576p?|hdcam|hdts|telesync)\b/gi, ' ')
    .replace(/\b(?:vostfr|vost|multi|truefrench|french|vff|vfq|vfi|vf)\b/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    // « HD », « SD »… ne sont retirés qu'en fin de nom, pour ne pas abîmer un vrai titre.
    .replace(/(?<=\S\s)\b(?:hd|sd|cam|vo)\b(?=\s*(?:$|[)\]|-]))/gi, ' ')
    .replace(/[(\[][\s\W]*[)\]]/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-|:.,]+$/g, '')
    .trim();

  if (!year) {
    const tail = s.match(/^(.*\S)[\s\-.,]+((?:19|20)\d{2})$/);
    if (tail && /[a-zA-ZÀ-ɏ]/.test(tail[1])) {
      year = +tail[2];
      s = tail[1].replace(/[\s\-|:.,]+$/g, '').trim();
    }
  }
  const now = new Date().getFullYear();
  if (year && (year < 1900 || year > now + 1)) year = 0;

  return { title: s || String(raw ?? '').trim(), year, quality, hdr, lang };
}

/** « Ma Série S02 E05 - Titre » → { show, season, episode, title }. */
export function parseEpisode(raw) {
  const s = String(raw ?? '');
  const m = s.match(/^(.*?)[\s\-._|]*\b(?:S(\d{1,2})[\s._-]*E(\d{1,3})|(\d{1,2})x(\d{2,3}))\b[\s\-:._|]*(.*)$/i);
  if (!m) return null;
  const show = m[1].trim();
  if (!show) return null;
  return {
    show,
    season: +(m[2] ?? m[4]),
    episode: +(m[3] ?? m[5]),
    title: m[6].trim(),
  };
}

// Genres canoniques (libellés français, alignés sur TMDB).
const GENRE_RULES = [
  [/science.?fiction|sci.?fi|\bsf\b/, 'Science-Fiction'],
  [/\baction\b/, 'Action'],
  [/aventure|adventure/, 'Aventure'],
  [/anim|manga|dessin|cartoon/, 'Animation'],
  [/comed|comique|humour/, 'Comédie'],
  [/crim|polic|gangster/, 'Crime'],
  [/docu/, 'Documentaire'],
  [/dram/, 'Drame'],
  [/famil|enfant|kids|jeunesse/, 'Familial'],
  [/fantast|fantasy/, 'Fantastique'],
  [/histo|biopic|biograph/, 'Histoire'],
  [/horreur|horror|epouvante/, 'Horreur'],
  [/musi|concert/, 'Musique'],
  [/myster/, 'Mystère'],
  [/romance|romanti|amour/, 'Romance'],
  [/thriller|suspense/, 'Thriller'],
  [/guerre|\bwar\b/, 'Guerre'],
  [/western/, 'Western'],
  [/spectacle|stand.?up/, 'Spectacle'],
  [/tele.?film|tv movie/, 'Téléfilm'],
];

/** Genres reconnus dans une chaîne libre (catégorie fournisseur, « Drama, Crime »…). */
export function detectGenres(text) {
  const f = fold(text);
  const out = [];
  for (const [re, name] of GENRE_RULES) if (re.test(f) && !out.includes(name)) out.push(name);
  return out;
}

/** Nettoie un nom de catégorie fournisseur (« FR | ACTION » → « Action »). */
export function cleanCategory(name) {
  let s = String(name ?? '').trim();
  s = s.replace(/^\s*(?:[\[|(]?\s*(?:VOD|FR|EN|US|UK|FILMS?|MOVIES?|SERIES?)\s*[\]|)]?\s*[-:|]+\s*)+/i, '').trim();
  if (!s) s = String(name ?? '').trim();
  if (s === s.toUpperCase() && s.length > 3) {
    s = s.toLowerCase().replace(/(^|[\s\-/&])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
  }
  return s;
}

export function versionLabel(v) {
  return [v.quality, v.hdr ? 'HDR' : '', v.lang, v.ext ? v.ext.toUpperCase() : ''].filter(Boolean).join(' · ');
}

const STOP = new Set(('le la les l un une des du de d et ou a au aux en the of and an in on to for with at by from ' +
  'el los las y der die das und il lo gli i e di da part partie chapitre chapter vol volume film movie ii iii iv').split(' '));

/** Mots significatifs d'un titre (pour la recherche et les rapprochements de sagas). */
export function titleTokens(title) {
  return normKey(title).split(' ').filter((t) => t.length > 1 && !STOP.has(t) && !/^\d+$/.test(t));
}
