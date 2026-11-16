// Navigation « télécommande » : les flèches déplacent le focus vers l'élément
// le plus proche dans la direction voulue, Entrée valide, Retour revient en arrière.

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), textarea, [tabindex="0"]';
const DIRS = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const BACK_KEYS = new Set(['Escape', 'BrowserBack', 'GoBack', 'XF86Back']);
const BACK_CODES = new Set([461, 10009]); // LG webOS, Samsung Tizen

/** Zone de recherche du focus : une fenêtre modale ou le lecteur le capturent. */
function scope() {
  const scopes = document.querySelectorAll('[data-focus-scope]');
  return scopes.length ? scopes[scopes.length - 1] : document.body;
}

function visible(el) {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function candidates(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => el.tabIndex !== -1 && visible(el));
}

function isTextField(el) {
  return el instanceof HTMLTextAreaElement || (el instanceof HTMLInputElement && !['checkbox', 'radio', 'range', 'button', 'submit', 'file'].includes(el.type));
}

function findNext(from, dir) {
  const a = from.getBoundingClientRect();
  const horizontal = dir === 'left' || dir === 'right';
  // Dans une rangée défilante, gauche/droite ne quittent pas la rangée.
  const lane = horizontal ? from.closest('[data-lane]') : null;
  let best = null;
  let bestScore = Infinity;
  for (const el of candidates(lane || scope())) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const overlapY = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
    const overlapX = Math.min(a.right, b.right) - Math.max(a.left, b.left);
    let main;
    let cross;
    if (dir === 'right') { if (b.left < a.left + 1 || b.right <= a.right) continue; main = Math.max(0, b.left - a.right); }
    else if (dir === 'left') { if (b.right > a.right - 1 || b.left >= a.left) continue; main = Math.max(0, a.left - b.right); }
    else if (dir === 'down') { if (b.top < a.top + 1 || b.bottom <= a.bottom) continue; main = Math.max(0, b.top - a.bottom); }
    else { if (b.bottom > a.bottom - 1 || b.top >= a.top) continue; main = Math.max(0, a.top - b.bottom); }
    if (horizontal) {
      // Un déplacement latéral doit rester sur la même ligne.
      if (overlapY <= Math.min(a.height, b.height) * 0.25) continue;
      cross = Math.abs((a.top + a.bottom) / 2 - (b.top + b.bottom) / 2) * 0.1;
    } else {
      cross = overlapX > 0 ? 0 : Math.min(Math.abs(a.left - b.right), Math.abs(b.left - a.right)) + 40;
      // À recouvrement égal, on préfère l'élément dont le bord gauche est le plus proche.
      cross += Math.abs(a.left - b.left) * 0.05;
    }
    const score = main + cross * 3;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return best;
}

export function reveal(el, smooth = true) {
  const behavior = smooth ? 'smooth' : 'auto';
  if (el.closest('[data-scroll-top]')) window.scrollTo({ top: 0, behavior });
  el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior });
}

export function focusEl(el, smooth = true) {
  if (!el) return false;
  el.focus({ preventScroll: true });
  reveal(el, smooth);
  return true;
}

/** Place le focus sur l'élément par défaut de la vue affichée. */
export function focusDefault() {
  const root = scope();
  const el = root.querySelector('[data-autofocus]') || candidates(root.querySelector('#view') || root)[0] || candidates(root)[0];
  return focusEl(el, false);
}

export const keysMode = () => document.body.classList.contains('keys');

export function initFocus({ onBack }) {
  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const active = document.activeElement;
    const typing = active && isTextField(active);

    if (BACK_KEYS.has(e.key) || BACK_CODES.has(e.keyCode) || (e.key === 'Backspace' && !typing)) {
      if (typing && e.key === 'Escape' && active.value) return; // Échap vide d'abord le champ
      e.preventDefault();
      onBack();
      return;
    }

    const dir = DIRS[e.key];
    if (!dir) {
      if (e.key === 'Tab') document.body.classList.add('keys');
      return;
    }
    if (typing && (dir === 'left' || dir === 'right') && active.value) return;

    const first = !keysMode();
    document.body.classList.add('keys');
    const root = scope();
    if (!active || active === document.body || !root.contains(active) || !visible(active)) {
      e.preventDefault();
      focusDefault();
      return;
    }
    e.preventDefault();
    if (first) { reveal(active); return; }
    const next = findNext(active, dir);
    if (next) focusEl(next, !e.repeat);
  });

  // La souris ou le toucher masquent l'anneau de focus façon télécommande.
  const pointer = () => document.body.classList.remove('keys');
  window.addEventListener('mousemove', pointer, { passive: true });
  window.addEventListener('touchstart', pointer, { passive: true });
}
