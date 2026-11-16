// Petits utilitaires d'interface : création d'éléments, icônes, formats.

export function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  add(el, kids);
  return el;
}

/** Remplace le contenu d'un élément (les valeurs nulles et les tableaux sont acceptés). */
export function fill(el, ...kids) {
  el.replaceChildren();
  add(el, kids);
  return el;
}

function add(el, kid) {
  if (kid == null || kid === false || kid === '') return;
  if (Array.isArray(kid)) kid.forEach((k) => add(el, k));
  else el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
}

const ICONS = {
  play: '<path d="M8 5.1v13.8a1 1 0 0 0 1.5.9l11.3-6.9a1 1 0 0 0 0-1.8L9.5 4.2A1 1 0 0 0 8 5.1z"/>',
  pause: '<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>',
  plus: '<path d="M12 4.5v15M4.5 12h15" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="2.3"/><path d="M15.2 15.2L20 20" stroke="currentColor" stroke-width="2.3" stroke-linecap="round"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="15" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="9" cy="17" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/>',
  back: '<path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  next: '<path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>',
  rewind: '<path d="M11.5 6.2v11.6a.8.8 0 0 1-1.3.6L3.4 12.6a.8.8 0 0 1 0-1.2l6.8-5.8a.8.8 0 0 1 1.3.6zM20.5 6.2v11.6a.8.8 0 0 1-1.3.6l-6.8-5.8a.8.8 0 0 1 0-1.2l6.8-5.8a.8.8 0 0 1 1.3.6z"/>',
  forward: '<path d="M12.5 6.2v11.6a.8.8 0 0 0 1.3.6l6.8-5.8a.8.8 0 0 0 0-1.2l-6.8-5.8a.8.8 0 0 0-1.3.6zM3.5 6.2v11.6a.8.8 0 0 0 1.3.6l6.8-5.8a.8.8 0 0 0 0-1.2L4.8 5.6a.8.8 0 0 0-1.3.6z"/>',
  volume: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M18 6a8.5 8.5 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  mute: '<path d="M4 9.5v5h3.5l4.5 4v-13l-4.5 4H4z"/><path d="M16 9.5l5 5M21 9.5l-5 5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  fullscreen: '<path d="M4.5 9.5v-5h5M19.5 9.5v-5h-5M4.5 14.5v5h5M19.5 14.5v5h-5" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>',
  subtitles: '<rect x="3" y="5.5" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 11h4M7 14.5h7M14 11h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  audio: '<path d="M5 10v4M9 6.5v11M13 9v6M17 5v14M21 10v4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  star: '<path d="M12 3.6l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6z"/>',
  starOutline: '<path d="M12 3.6l2.5 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9l-5.1 2.7 1-5.8-4.2-4.1 5.8-.8L12 3.6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  shuffle: '<path d="M3.5 7h3.2c1.6 0 3 .8 3.9 2.1l2.8 4.3c.9 1.300 2.300 2.100 3.900 2.100h3.200M17.800 4.500L20.500 7l-2.700 2.500M3.500 17h3.200c1.200 0 2.300-.5 3.100-1.300M13.500 8.300c.800-.800 1.900-1.300 3.100-1.300h3.900M17.800 14.500l2.700 2.500-2.700 2.500" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  home: '<path d="M4 11l8-6.500 8 6.500v8a1 1 0 0 1-1 1h-4.500v-5.500h-5V20H5a1 1 0 0 1-1-1v-8z"/>',
  film: '<rect x="3.500" y="4.500" width="17" height="15" rx="2.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 4.500v15M16 4.500v15M3.500 9.500H8M3.500 14.500H8M16 9.500h4.500M16 14.500h4.500" stroke="currentColor" stroke-width="2"/>',
  series: '<rect x="3" y="7.500" width="18" height="12" rx="2.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M6.500 4.500h11" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  tv: '<rect x="3" y="5" width="18" height="12" rx="2.500" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.500 20h7" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  sparkle: '<path d="M12 3l1.900 5.100L19 10l-5.100 1.900L12 17l-1.900-5.100L5 10l5.100-1.900L12 3zM18.500 15l.900 2.100 2.100.900-2.100.900-.900 2.100-.900-2.100-2.100-.900 2.100-.900.900-2.100z"/>',
  replay: '<path d="M5.500 12a6.500 6.500 0 1 0 2.200-4.900M5 4.500v3.500h3.500" fill="none" stroke="currentColor" stroke-width="2.200" stroke-linecap="round" stroke-linejoin="round"/>',
  trash: '<path d="M5 7h14M9.500 7V5h5v2M7 7l.800 12h8.400L17 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
};

export function icon(name) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

/** 105 → « 1 h 45 » */
export function fmtMinutes(min) {
  if (!min) return '';
  const hh = Math.floor(min / 60);
  const mm = Math.round(min % 60);
  return hh ? `${hh} h ${String(mm).padStart(2, '0')}` : `${mm} min`;
}

/** 3754 → « 1:02:34 » */
export function fmtClock(sec) {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec % 60);
  const m = Math.floor(sec / 60) % 60;
  const hh = Math.floor(sec / 3600);
  return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtHour(ts) {
  return new Date(ts * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

let toastTimer;
export function toast(message) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// Le routeur consulte ce drapeau pour savoir si la navigation remplace l'entrée d'historique.
export const navFlags = { replace: false };

export function go(hash, replace = false) {
  if (replace) {
    navFlags.replace = true;
    location.replace(hash);
  } else {
    location.hash = hash;
  }
}
