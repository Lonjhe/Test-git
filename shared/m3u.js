// Lecture des playlists M3U / M3U8 « étendues » (#EXTINF).

const ATTR = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

export function parseM3u(text) {
  const entries = [];
  let pending = null;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const attrs = {};
      let lastAttrEnd = 0;
      for (const m of line.matchAll(ATTR)) {
        attrs[m[1].toLowerCase()] = m[2];
        lastAttrEnd = m.index + m[0].length;
      }
      // Le nom affiché suit la première virgule située après les attributs.
      const comma = line.indexOf(',', lastAttrEnd);
      const name = (comma >= 0 ? line.slice(comma + 1) : '').trim() || attrs['tvg-name'] || '';
      pending = {
        name,
        logo: attrs['tvg-logo'] || '',
        group: attrs['group-title'] || '',
        epgId: attrs['tvg-id'] || '',
      };
    } else if (line.startsWith('#EXTGRP:') && pending) {
      pending.group = pending.group || line.slice(8).trim();
    } else if (!line.startsWith('#')) {
      if (pending && /^(https?|rtmp|rtsp|udp|rtp|mms):\/\//i.test(line)) {
        entries.push({ ...pending, url: line });
      }
      pending = null;
    }
  }
  return entries;
}

const VOD_EXT = /\.(mp4|mkv|avi|mov|m4v|wmv|flv|webm|mpg|mpeg)(?:$|\?)/i;

/** Devine la nature d'une entrée : chaîne en direct, film ou épisode. */
export function classifyEntry(entry) {
  let pathname = '';
  try { pathname = new URL(entry.url).pathname; } catch { pathname = entry.url; }
  if (/\/series\//i.test(pathname)) return 'episode';
  if (/\/movie\//i.test(pathname)) return 'movie';
  if (VOD_EXT.test(pathname)) return /\bS\d{1,2}[\s._-]*E\d{1,3}\b/i.test(entry.name) ? 'episode' : 'movie';
  return 'live';
}

export function extOf(url) {
  try {
    const m = new URL(url).pathname.match(/\.([a-z0-9]{2,5})$/i);
    return m ? m[1].toLowerCase() : '';
  } catch {
    return '';
  }
}

/** Type de lecteur à utiliser selon l'URL du flux. */
export function playbackType(url, kind) {
  const ext = extOf(url);
  if (ext === 'm3u8' || ext === 'm3u') return 'hls';
  if (ext === 'ts' || (kind === 'live' && !ext)) return 'mpegts';
  return 'file';
}
