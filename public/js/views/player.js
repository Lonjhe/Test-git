// Lecteur vidéo plein écran : HLS (hls.js), MPEG-TS (mpegts.js) ou fichier direct,
// reprise de lecture, pistes audio / sous-titres, zapping, épisode suivant.
import { h, icon, fmtClock, fmtHour, toast, go, fill } from '../dom.js';
import { api } from '../api.js';
import { store, saveProgress, isFav, toggleFav } from '../store.js';
import { keysMode } from '../focus.js';

const scripts = {};
function loadScript(src) {
  return (scripts[src] ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL(src, document.baseURI).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`Chargement de ${src} impossible`));
    document.head.append(s);
  }));
}

export function player(ctx) {
  const playId = ctx.arg;
  const known = store.byId.get(playId);
  const pc = store.playContext?.id === playId || store.playContext?.queue?.some((q) => (q.id || q) === playId) ? store.playContext : null;
  const stored = store.progress[playId];
  const isLive = known?.kind === 'channel';
  const isMovie = known?.kind === 'movie';

  // Ce qu'on affiche et ce qu'on enregistre pour la reprise.
  // La file d'attente contient soit des identifiants (chaînes), soit des objets (épisodes).
  const found = pc?.queue?.find((q) => (q.id || q) === playId);
  const queueEntry = typeof found === 'object' ? found : null;
  const meta = {
    key: isMovie ? known.id : playId,
    kind: isLive ? 'channel' : isMovie ? 'movie' : 'episode',
    title: known?.title || pc?.title || stored?.title || 'Lecture',
    sub: isMovie ? (known.versions?.find((v) => v.id === playId)?.label || '') : queueEntry?.sub || (isLive ? known.cat : stored?.sub || ''),
    poster: isMovie ? known.poster : queueEntry?.poster || pc?.poster || stored?.poster || '',
    parent: isMovie || isLive ? '' : pc?.parent || stored?.parent || '',
  };

  const video = h('video', { playsinline: true, preload: 'auto' });
  const title = h('div', { class: 'p-title' }, h('b', {}, meta.title), meta.sub ? h('span', {}, meta.sub) : null);
  const status = h('div', { class: 'p-status' });
  const elapsed = h('span', { class: 'time' }, '0:00');
  const remaining = h('span', { class: 'time' }, '');
  const played = h('i', { class: 'fill' });
  const buffered = h('i', { class: 'buffered' });
  const knob = h('i', { class: 'knob' });
  const scrub = h('div', { class: 'scrub', tabindex: '0', role: 'slider', 'aria-label': 'Position de lecture', 'aria-valuemin': '0', dataset: { fkey: 'scrub' } }, buffered, played, knob);
  const playBtn = h('button', { class: 'p-btn big', type: 'button', 'aria-label': 'Lecture / pause', onclick: () => toggle() }, icon('pause'));
  const tracksBtn = h('button', { class: 'p-btn', type: 'button', hidden: true, 'aria-label': 'Audio et sous-titres', onclick: () => openTracks() }, icon('subtitles'));
  const muteBtn = h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Couper le son', onclick: () => { video.muted = !video.muted; } }, icon('volume'));
  const fsBtn = h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Plein écran', onclick: () => fullscreen() }, icon('fullscreen'));
  const favBtn = isLive ? h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Chaîne favorite', onclick: () => { toast(toggleFav(playId) ? 'Ajoutée aux favoris' : 'Retirée des favoris'); paintFav(); } }) : null;
  const paintFav = () => favBtn && fill(favBtn, icon(isFav(playId) ? 'star' : 'starOutline'));
  paintFav();
  const overlay = h('div', { class: 'p-overlay' });
  const menu = h('div', { class: 'p-menu', hidden: true });

  const queueIds = (pc?.queue || []).map((q) => q.id || q);
  const qi = queueIds.indexOf(playId);
  const neighbor = (d) => (qi < 0 || !queueIds.length ? null : isLive ? queueIds[(qi + d + queueIds.length) % queueIds.length] : queueIds[qi + d] || null);
  const jump = (id) => id && id !== playId && go(`#/lecture/${encodeURIComponent(id)}`, true);

  const controls = h('div', { class: 'p-controls' },
    isLive
      ? h('div', { class: 'p-live' }, h('span', { class: 'live-badge' }, 'EN DIRECT'), status)
      : h('div', { class: 'p-timeline' }, elapsed, scrub, remaining),
    h('div', { class: 'p-buttons', 'data-lane': true },
      isLive
        ? h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Chaîne précédente', disabled: queueIds.length < 2 || null, onclick: () => jump(neighbor(-1)) }, icon('back'))
        : h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Reculer de 10 secondes', onclick: () => seekBy(-10) }, icon('rewind')),
      playBtn,
      isLive
        ? h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Chaîne suivante', disabled: queueIds.length < 2 || null, onclick: () => jump(neighbor(1)) }, icon('next'))
        : h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Avancer de 10 secondes', onclick: () => seekBy(10) }, icon('forward')),
      h('span', { class: 'grow' }),
      !isLive && neighbor(1) ? h('button', { class: 'p-btn text', type: 'button', onclick: () => jump(neighbor(1)) }, 'Épisode suivant') : null,
      favBtn, tracksBtn, muteBtn, fsBtn,
    ),
  );
  const root = h('div', { class: 'player', 'data-focus-scope': true },
    video,
    h('div', { class: 'p-top' }, h('button', { class: 'p-btn', type: 'button', 'aria-label': 'Retour', onclick: () => history.back() }, icon('back')), title),
    overlay, menu, controls,
  );

  let hls = null;
  let mts = null;
  let info = null;
  let attempts = [];
  let hideTimer;
  let saveTimer;
  let wakeLock = null;
  let startAt = ctx.query.has('t') ? +ctx.query.get('t') || 0 : (stored && !stored.done && stored.pos > 20 ? stored.pos : 0);
  if (isMovie && !ctx.query.has('t')) {
    const p = store.progress[known.id];
    startAt = p && !p.done && p.pos > 20 ? p.pos : 0;
  }
  // Lecture convertie par le serveur (ffmpeg) : le flux reçu commence à `base`
  // secondes du film et n'annonce pas sa durée, connue par ailleurs (`dur`).
  let conv = null;
  let lastPos = 0;
  const duration = () => (conv ? conv.dur : Number.isFinite(video.duration) ? video.duration : 0);
  const now = () => (conv ? conv.base : 0) + (video.currentTime || 0);

  async function playConvertedHls(url) {
    try {
      if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) {
        video.src = url;
      } else {
        await loadScript('vendor/hls.min.js');
        hls = new window.Hls({ enableWorker: true, backBufferLength: 60 });
        hls.on(window.Hls.Events.ERROR, (_, data) => { if (data.fatal) fail(data.details || 'erreur HLS'); });
        hls.loadSource(url);
        hls.attachMedia(video);
      }
      video.play().catch(() => paintPlay());
    } catch (err) {
      fail(err.message);
    }
  }

  function playConverted(at) {
    const dur = conv?.dur || 0;
    hls?.destroy();
    hls = null;
    conv = { base: Math.max(0, Math.floor(at)), dur };
    fill(overlay, h('div', { class: 'spin' }));
    // Safari, iPhone, iPad et les apps Apple lisent le HLS, pas un MP4 envoyé en continu.
    const apple = /AppleWebKit/.test(navigator.userAgent) && !/Chrome|Chromium|Edg|Android/.test(navigator.userAgent);
    if (info.convertHls && (apple || ctx.query.get('conv') === 'hls')) {
      playConvertedHls(new URL(`${info.convertHls}?t=${conv.base}`, document.baseURI).href);
    } else {
      video.src = new URL(`${info.convert}?t=${conv.base}`, document.baseURI).href;
      video.play().catch(() => paintPlay());
    }
    if (!dur) {
      api.get(`/api/probe/${encodeURIComponent(playId)}`).then((d) => {
        if (ctx.alive && conv) { conv.dur = d.duration || 0; paintTime(); }
      }).catch(() => {});
    }
  }

  // ——— Chargement du flux, avec solutions de repli ———
  function teardown() {
    hls?.destroy();
    hls = null;
    try { mts?.destroy(); } catch { /* déjà détruit */ }
    mts = null;
    video.removeAttribute('src');
    video.load();
  }

  async function attach({ url, type }) {
    teardown();
    fill(overlay, h('div', { class: 'spin' }));
    try {
      if (type === 'hls') {
        if (video.canPlayType('application/vnd.apple.mpegurl') && !window.MediaSource && !window.ManagedMediaSource) {
          video.src = url; // Safari / iOS lisent le HLS nativement
        } else {
          await loadScript('vendor/hls.min.js');
          if (!window.Hls?.isSupported()) throw new Error('HLS non pris en charge');
          let recovered = 0;
          hls = new window.Hls({ enableWorker: true, lowLatencyMode: false, backBufferLength: 60, startPosition: startAt > 0 && !isLive ? startAt : -1 });
          hls.on(window.Hls.Events.ERROR, (_, data) => {
            if (!data.fatal) return;
            if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR && recovered++ < 2) hls.recoverMediaError();
            else if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && recovered++ < 2) hls.startLoad();
            else fail(data.details || 'erreur HLS');
          });
          hls.on(window.Hls.Events.MANIFEST_PARSED, paintTracksButton);
          hls.on(window.Hls.Events.SUBTITLE_TRACKS_UPDATED, paintTracksButton);
          hls.on(window.Hls.Events.AUDIO_TRACKS_UPDATED, paintTracksButton);
          hls.loadSource(url);
          hls.attachMedia(video);
        }
      } else if (type === 'mpegts') {
        await loadScript('vendor/mpegts.js');
        if (!window.mpegts?.isSupported()) throw new Error('MPEG-TS non pris en charge');
        mts = window.mpegts.createPlayer({ type: 'mpegts', isLive, url: new URL(url, location.href).href }, { enableWorker: false, liveBufferLatencyChasing: false });
        mts.on(window.mpegts.Events.ERROR, (kind, detail) => fail(String(detail || kind)));
        mts.attachMediaElement(video);
        mts.load();
      } else if (type === 'convert') {
        toast('Format non pris en charge par le navigateur : conversion en cours…');
        playConverted(lastPos || startAt);
        return;
      } else {
        video.src = url;
      }
      video.play().catch(() => paintPlay());
    } catch (err) {
      fail(err.message);
    }
  }

  /**
   * Interroge le flux pour dire pourquoi la lecture a échoué : refus du
   * fournisseur, ou vidéo bien reçue mais que le navigateur ne sait pas décoder.
   */
  async function diagnose() {
    if (!info?.url) return '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12_000);
    try {
      const res = await fetch(new URL(info.url, document.baseURI), { headers: { Range: 'bytes=0-1023' }, signal: controller.signal });
      const type = (res.headers.get('content-type') || '').split(';')[0];
      const text = /^text\/plain/.test(type) && !res.ok ? (await res.text()).slice(0, 200) : '';
      controller.abort();
      if (res.status === 502) return `Le flux est injoignable. ${text}`;
      if (!res.ok) {
        return `Votre fournisseur a refusé ce flux (réponse ${res.status}). Causes fréquentes : trop de connexions simultanées sur l'abonnement `
          + '(fermez les autres lecteurs), abonnement expiré, ou contenu retiré.';
      }
      if (/^(text\/html|application\/json)/.test(type)) return 'Votre fournisseur a renvoyé une page au lieu d\'une vidéo : ce contenu n\'est sans doute plus disponible.';
      const ext = (info.external || '').match(/\.([a-z0-9]{2,4})(?:$|\?)/i)?.[1]?.toUpperCase();
      return `Le flux arrive correctement${ext ? ` (fichier ${ext})` : ''} : c'est ce navigateur qui ne sait pas le décoder. `
        + (info.ffmpeg === false
          ? 'Installez ffmpeg sur l\'ordinateur qui fait tourner Séance (voir le README) : elle convertira alors ces vidéos automatiquement.'
          : 'Essayez Chrome si vous utilisez Safari, une autre version du film, ou ouvrez le lien dans VLC.');
    } catch {
      return '';
    } finally {
      clearTimeout(timer);
    }
  }

  function fail(reason) {
    if (!ctx.alive) return;
    const next = attempts.shift();
    if (next) { attach(next); return; }
    teardown();
    const verdict = h('p', { class: 'verdict' }, 'Recherche de la cause…');
    diagnose().then((text) => { if (ctx.alive) verdict.textContent = text; });
    const versions = isMovie ? (known.versions || []).filter((v) => v.id !== playId) : [];
    fill(overlay, h('div', { class: 'p-error' },
      h('h2', {}, 'Lecture impossible'),
      h('p', {}, isLive
        ? 'La chaîne ne répond pas ou son format n\'est pas pris en charge par ce navigateur.'
        : 'Le flux ne répond pas, ou ce navigateur ne sait pas lire ce format (certains fichiers MKV, HEVC ou au son AC3/DTS).'),
      // Version en ligne : le navigateur s'adresse directement au fournisseur, sans relais.
      info?.direct ? h('p', {}, location.protocol === 'https:' && /^http:/i.test(info.url)
        ? 'Ce flux n\'est proposé qu\'en HTTP : depuis cette page sécurisée (HTTPS), le navigateur refuse de le lire. Installez Séance chez vous pour le regarder.'
        : 'Depuis la version en ligne, le fournisseur doit autoriser la lecture directe par un site web. Si rien ne se lit, installez Séance chez vous : son serveur relaie les flux.') : null,
      verdict,
      h('p', { class: 'fine' }, `Détail : ${reason}`),
      h('div', { class: 'actions', 'data-lane': true },
        h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => start() }, 'Réessayer'),
        ...versions.slice(0, 3).map((v) => h('button', { class: 'btn', type: 'button', onclick: () => jump(v.id) }, `Essayer ${v.label}`)),
        info?.external ? h('button', {
          class: 'btn', type: 'button',
          onclick: async () => {
            try { await navigator.clipboard.writeText(info.external); toast('Lien copié : ouvrez-le dans VLC ou un autre lecteur'); } catch { prompt('Lien du flux (à ouvrir dans VLC) :', info.external); }
          },
        }, 'Copier le lien pour VLC') : null,
        h('button', { class: 'btn', type: 'button', onclick: () => history.back() }, 'Retour'),
      )));
    root.classList.add('show');
    if (keysMode()) overlay.querySelector('[data-autofocus]')?.focus();
  }

  async function start() {
    fill(overlay, h('div', { class: 'spin' }));
    try {
      info = await api.get(`/api/play/${encodeURIComponent(playId)}`);
    } catch (err) {
      attempts = [];
      fail(err.message);
      return;
    }
    if (!ctx.alive) return;
    attempts = [info.alt, info.type !== 'file' ? { url: info.url, type: 'file' } : null, info.convert ? { type: 'convert' } : null].filter(Boolean);
    conv = null;
    attach(info);
  }

  // ——— Commandes ———
  function toggle() {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
  }
  function seekTo(t) {
    const d = duration();
    if (!d) return;
    const target = Math.min(Math.max(0, t), Math.max(0, d - 0.5));
    if (conv) playConverted(target); // la conversion repart de la position demandée
    else video.currentTime = target;
    paintTime();
  }
  const seekBy = (delta) => { if (!isLive) seekTo(now() + delta); };
  function fullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else root.requestFullscreen?.().catch(() => {});
  }

  function paintPlay() {
    fill(playBtn, icon(video.paused ? 'play' : 'pause'));
    root.classList.toggle('paused', video.paused);
  }
  function paintTime() {
    if (isLive) return;
    const d = duration();
    const t = now();
    if (t > 1) lastPos = t;
    elapsed.textContent = fmtClock(t);
    remaining.textContent = d ? `-${fmtClock(d - t)}` : '';
    const pct = d ? (t / d) * 100 : 0;
    played.style.width = `${pct}%`;
    knob.style.left = `${pct}%`;
    scrub.setAttribute('aria-valuemax', String(Math.round(d)));
    scrub.setAttribute('aria-valuenow', String(Math.round(t)));
    scrub.setAttribute('aria-valuetext', `${fmtClock(t)} sur ${fmtClock(d)}`);
    if (d && video.buffered.length) buffered.style.width = `${Math.min(100, (((conv ? conv.base : 0) + video.buffered.end(video.buffered.length - 1)) / d) * 100)}%`;
  }

  function wake(keep) {
    root.classList.add('show');
    clearTimeout(hideTimer);
    if (keep) return;
    hideTimer = setTimeout(() => {
      if (!video.paused && menu.hidden && !overlay.querySelector('.p-error, .p-next')) root.classList.remove('show');
    }, 3500);
  }

  // ——— Pistes audio et sous-titres ———
  function trackLists() {
    const audio = hls
      ? hls.audioTracks.map((t, i) => ({ label: t.name || t.lang || `Piste ${i + 1}`, on: hls.audioTrack === i, pick: () => { hls.audioTrack = i; } }))
      : [...(video.audioTracks || [])].map((t, i) => ({ label: t.label || t.language || `Piste ${i + 1}`, on: t.enabled, pick: () => { [...video.audioTracks].forEach((x, k) => { x.enabled = k === i; }); } }));
    let subs;
    if (hls) {
      subs = hls.subtitleTracks.map((t, i) => ({ label: t.name || t.lang || `Sous-titres ${i + 1}`, on: hls.subtitleTrack === i, pick: () => { hls.subtitleDisplay = true; hls.subtitleTrack = i; } }));
      if (subs.length) subs.unshift({ label: 'Désactivés', on: hls.subtitleTrack === -1, pick: () => { hls.subtitleTrack = -1; } });
    } else {
      const tt = [...video.textTracks].filter((t) => t.kind === 'subtitles' || t.kind === 'captions');
      subs = tt.map((t, i) => ({ label: t.label || t.language || `Sous-titres ${i + 1}`, on: t.mode === 'showing', pick: () => { tt.forEach((x, k) => { x.mode = k === i ? 'showing' : 'disabled'; }); } }));
      if (subs.length) subs.unshift({ label: 'Désactivés', on: !tt.some((t) => t.mode === 'showing'), pick: () => { tt.forEach((x) => { x.mode = 'disabled'; }); } });
    }
    return { audio: audio.length > 1 ? audio : [], subs };
  }
  function paintTracksButton() {
    const { audio, subs } = trackLists();
    tracksBtn.hidden = !audio.length && !subs.length;
  }
  function openTracks() {
    if (!menu.hidden) { closeMenu(); return; }
    const { audio, subs } = trackLists();
    const group = (name, items) => (items.length ? h('div', { class: 'p-group' }, h('h3', {}, name),
      items.map((t) => h('button', { class: `p-option ${t.on ? 'on' : ''}`, type: 'button', onclick: () => { t.pick(); closeMenu(); tracksBtn.focus(); } }, t.on ? icon('check') : h('span', { class: 'icon' }), t.label))) : null);
    fill(menu, group('Audio', audio), group('Sous-titres', subs));
    menu.hidden = false;
    wake(true);
    (menu.querySelector('.p-option.on') || menu.querySelector('.p-option'))?.focus();
  }
  function closeMenu() {
    menu.hidden = true;
    wake();
  }

  // ——— Progression et fin de lecture ———
  function save(done = false) {
    if (isLive) return;
    const d = duration();
    const t = now();
    if (!d || (t < 5 && !done)) return;
    saveProgress({
      id: meta.key, pos: Math.floor(t), dur: Math.floor(d), done: done || t / d > 0.93,
      kind: meta.kind, title: meta.title, sub: meta.sub, poster: meta.poster, parent: meta.parent, play: playId,
    });
  }

  function ended() {
    // Un direct qui s'arrête est une coupure : on se reconnecte.
    if (isLive) { setTimeout(() => { if (ctx.alive) start(); }, 1000); return; }
    save(true);
    const next = !isLive && neighbor(1);
    if (!next) { history.back(); return; }
    let left = 8;
    const label = h('p', {});
    const tick = () => { label.textContent = `Épisode suivant dans ${left} s`; };
    tick();
    const timer = setInterval(() => {
      if (!ctx.alive) { clearInterval(timer); return; }
      if (--left <= 0) { clearInterval(timer); jump(next); } else tick();
    }, 1000);
    ctx.onCleanup(() => clearInterval(timer));
    fill(overlay, h('div', { class: 'p-next' }, label,
      h('div', { class: 'actions', 'data-lane': true },
        h('button', { class: 'btn primary', type: 'button', 'data-autofocus': true, onclick: () => { clearInterval(timer); jump(next); } }, icon('play'), 'Lire maintenant'),
        h('button', { class: 'btn', type: 'button', onclick: () => { clearInterval(timer); history.back(); } }, 'Arrêter'))));
    root.classList.add('show');
    if (keysMode()) overlay.querySelector('[data-autofocus]')?.focus();
  }

  // ——— Événements ———
  video.addEventListener('loadedmetadata', () => {
    if (startAt > 0 && !isLive && !hls && !conv && duration() > startAt + 15) video.currentTime = startAt;
    paintTime();
    paintTracksButton();
  });
  video.addEventListener('playing', () => { fill(overlay); paintPlay(); wake(); });
  // Certains fichiers se lisent sans le son (AC3, DTS…) : après quelques secondes
  // d'image sans aucun son décodé, on bascule sur la conversion.
  let soundCheck;
  video.addEventListener('playing', () => {
    clearTimeout(soundCheck);
    if (conv || hls || mts || !info?.convert || typeof video.webkitAudioDecodedByteCount !== 'number') return;
    soundCheck = setTimeout(() => {
      if (!ctx.alive || conv || video.paused || video.currentTime < 3) return;
      if (video.webkitAudioDecodedByteCount === 0 && video.webkitVideoDecodedByteCount > 0) {
        toast('Son non pris en charge par le navigateur : conversion en cours…');
        playConverted(now());
      }
    }, 5000);
  });
  ctx.onCleanup(() => clearTimeout(soundCheck));
  video.addEventListener('waiting', () => { if (!overlay.firstChild) fill(overlay, h('div', { class: 'spin' })); });
  video.addEventListener('canplay', () => { if (overlay.querySelector(':scope > .spin')) fill(overlay); });
  video.addEventListener('play', () => { paintPlay(); wake(); });
  video.addEventListener('pause', () => { paintPlay(); wake(true); save(); });
  video.addEventListener('timeupdate', paintTime);
  video.addEventListener('progress', paintTime);
  video.addEventListener('durationchange', paintTime);
  video.addEventListener('volumechange', () => fill(muteBtn, icon(video.muted || !video.volume ? 'mute' : 'volume')));
  video.addEventListener('ended', ended);
  video.addEventListener('error', () => { if (!hls && !mts && video.getAttribute('src')) fail(video.error?.message || 'format non pris en charge'); });
  video.addEventListener('click', () => { if (root.classList.contains('show')) toggle(); wake(); });
  video.addEventListener('dblclick', fullscreen);

  root.addEventListener('mousemove', () => wake());
  root.addEventListener('touchstart', () => wake(), { passive: true });

  const seekFromPointer = (e) => {
    const r = scrub.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * duration());
  };
  scrub.addEventListener('pointerdown', (e) => {
    scrub.setPointerCapture(e.pointerId);
    seekFromPointer(e);
    const move = (ev) => seekFromPointer(ev);
    scrub.addEventListener('pointermove', move);
    scrub.addEventListener('pointerup', () => scrub.removeEventListener('pointermove', move), { once: true });
  });

  root.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const hidden = !root.classList.contains('show');
    wake();
    const onButton = e.target instanceof HTMLButtonElement;
    const handled = () => { e.preventDefault(); e.stopPropagation(); };
    const blocked = overlay.querySelector('.p-error, .p-next');

    if (e.key === 'Escape' && !menu.hidden) { handled(); closeMenu(); tracksBtn.focus(); return; }
    if (blocked) return;

    // Commandes masquées : la première pression sur une flèche les fait simplement réapparaître.
    if (hidden && e.key.startsWith('Arrow') && (isLive || e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      handled();
      (isLive ? playBtn : scrub).focus();
      return;
    }
    switch (e.key) {
      case 'ArrowLeft':
      case 'ArrowRight':
        if (!isLive && (e.target === scrub || hidden || e.target === document.body)) {
          handled();
          seekBy(e.key === 'ArrowLeft' ? -10 : 10);
          scrub.focus();
        }
        break;
      case 'Enter':
        if (e.target === scrub || hidden) { handled(); toggle(); }
        break;
      case ' ':
      case 'k':
        if (!onButton || hidden) { handled(); toggle(); }
        break;
      case 'MediaPlayPause': handled(); toggle(); break;
      case 'MediaPlay': handled(); video.play().catch(() => {}); break;
      case 'MediaPause': handled(); video.pause(); break;
      case 'MediaStop': handled(); history.back(); break;
      case 'MediaFastForward': case 'l': handled(); seekBy(30); break;
      case 'MediaRewind': case 'j': handled(); seekBy(-30); break;
      case 'f': handled(); fullscreen(); break;
      case 'm': handled(); video.muted = !video.muted; break;
      case 'PageUp': case 'ChannelUp': case 'MediaTrackNext': handled(); jump(neighbor(1)); break;
      case 'PageDown': case 'ChannelDown': case 'MediaTrackPrevious': handled(); jump(neighbor(-1)); break;
      default:
    }
  });

  const onVisibility = () => { if (document.hidden) save(); };
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onVisibility);
  saveTimer = setInterval(() => { if (!video.paused) save(); }, 10_000);
  navigator.wakeLock?.request('screen').then((l) => { if (ctx.alive) wakeLock = l; else l.release(); }).catch(() => {});

  if (isLive) {
    api.get(`/api/epg/${encodeURIComponent(playId)}`).then((list) => {
      if (ctx.alive && list[0]) status.textContent = `${fmtHour(list[0].start)} · ${list[0].title}${list[1] ? `   —   ensuite : ${list[1].title}` : ''}`;
    }).catch(() => {});
  }

  ctx.onCleanup(() => {
    save();
    clearInterval(saveTimer);
    clearTimeout(hideTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', onVisibility);
    wakeLock?.release().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    teardown();
  });

  wake();
  start();
  queueMicrotask(() => { if (ctx.alive) (isLive ? playBtn : scrub).focus({ preventScroll: true }); });
  return root;
}
