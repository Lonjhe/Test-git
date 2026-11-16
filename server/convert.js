// Conversion à la volée avec ffmpeg, pour les vidéos que le navigateur ne sait pas
// décoder (MKV, AVI, son AC3/DTS…). Facultatif : sans ffmpeg, Séance fonctionne
// comme avant et se contente de signaler ces fichiers.
//
// La vidéo est recopiée telle quelle quand son codec passe dans un navigateur
// (H.264, HEVC) — ce qui ne coûte presque rien — et réencodée sinon. Le son est
// toujours converti en AAC stéréo. Le résultat est un MP4 « fragmenté », lisible
// au fur et à mesure qu'il est produit.
import { spawn, execFile } from 'node:child_process';

const FFMPEG = process.env.SEANCE_FFMPEG || 'ffmpeg';
const FFPROBE = process.env.SEANCE_FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');

let available;
/** ffmpeg et ffprobe sont-ils installés ? (vérifié une fois) */
export function hasFfmpeg() {
  available ??= Promise.all([FFMPEG, FFPROBE].map((bin) => new Promise((resolve) => {
    execFile(bin, ['-version'], { timeout: 10_000 }, (err) => resolve(!err));
  }))).then((oks) => oks.every(Boolean));
  return available;
}

const probes = new Map();
/** Durée et codecs d'un flux (résultat gardé en mémoire). */
export function probe(url, userAgent) {
  if (!probes.has(url)) {
    if (probes.size > 200) probes.clear();
    probes.set(url, new Promise((resolve, reject) => {
      const args = ['-v', 'error', '-user_agent', userAgent, '-show_entries', 'format=duration:stream=codec_type,codec_name', '-of', 'json', url];
      execFile(FFPROBE, args, { timeout: 45_000, maxBuffer: 4 << 20 }, (err, stdout) => {
        if (err) return reject(new Error('Analyse du flux impossible'));
        try {
          const data = JSON.parse(stdout);
          const codec = (type) => (data.streams || []).find((s) => s.codec_type === type)?.codec_name || '';
          resolve({ duration: Math.round(parseFloat(data.format?.duration) || 0), video: codec('video'), audio: codec('audio') });
        } catch {
          reject(new Error('Analyse du flux impossible'));
        }
      });
    }));
    probes.get(url).catch(() => probes.delete(url));
  }
  return probes.get(url);
}

/** Envoie le flux converti en MP4 à partir de `start` secondes. */
export async function convert(req, res, url, userAgent, start = 0) {
  const info = await probe(url, userAgent).catch(() => ({ video: '', audio: '' }));
  const video = info.video === 'h264' ? ['-c:v', 'copy']
    : info.video === 'hevc' ? ['-c:v', 'copy', '-tag:v', 'hvc1']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p'];
  const args = [
    '-hide_banner', '-loglevel', 'error', '-user_agent', userAgent,
    '-reconnect', '1', '-reconnect_streamed', '1', '-reconnect_delay_max', '5',
    ...(start > 0 ? ['-ss', String(start)] : []),
    '-i', url,
    '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
    ...video,
    '-c:a', 'aac', '-ac', '2', '-b:a', '160k',
    '-f', 'mp4', '-movflags', 'frag_keyframe+empty_moov+default_base_moof', 'pipe:1',
  ];
  const child = spawn(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stderr.on('data', (d) => { log = (log + d).slice(-2000); });
  // Le spectateur ferme le lecteur ou change de position : on arrête la conversion.
  res.on('close', () => child.kill('SIGKILL'));
  child.on('error', () => { if (!res.headersSent) { res.writeHead(500); res.end('ffmpeg indisponible'); } });
  child.stdout.once('data', (first) => {
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Cache-Control': 'no-store' });
    res.write(first);
    child.stdout.pipe(res);
  });
  child.on('close', (code) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(`Conversion impossible : ${log.trim().split('\n').pop() || `ffmpeg s'est arrêté (code ${code})`}`);
    } else {
      res.end();
    }
  });
}
