import fs from 'fs'; import path from 'path'; import { spawnSync } from 'child_process';
import { capture } from './capture.mjs'; import { endCopy } from './copy.mjs'; import { buildSound } from './sound.mjs'; import { resolveMusic } from './music.mjs'; import { render } from './render.mjs'; import { stills } from './stills.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname); process.chdir(ROOT);
const argv = process.argv.slice(2), flags = {}, pos = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]; if (!a.startsWith('--')) { pos.push(a); continue; }
  const k = a.slice(2); if (['stills-only', 'hw', 'recapture', 'no-sound'].includes(k) || argv[i + 1]?.startsWith('--') || i + 1 >= argv.length) flags[k] = true; else flags[k] = argv[++i];
}
const url = pos[0]; if (!url) { console.log(fs.readFileSync(new URL(import.meta.url)).toString().split('\n').slice(1, 6).join('\n')); process.exit(1); }
const host = new URL(url).hostname.replace(/^www\./, '');
const name = flags.name || host.replace(/\.(vercel\.app|netlify\.app|com|io|co|es|ro|net|org|app|dev)$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase();
const sceneDir = `scenes/${name}`;
let site = flags.site || null;
if (!site) for (const f of fs.existsSync('sites') ? fs.readdirSync('sites') : []) {
  if (!f.endsWith('.json') || f.startsWith('._')) continue; const j = JSON.parse(fs.readFileSync(`sites/${f}`, 'utf8')); if (j.match && host.endsWith(j.match)) site = `sites/${f}`; }
const T = { start: Date.now() }; const lap = k => { T[k] = (Date.now() - T.start) / 1000; };

let scene;
if (flags.recapture || !fs.existsSync(`${sceneDir}/scene.json`)) {
  console.log(`capture ${url}${site ? ' + ' + site : ''}`); scene = await capture(url, { out: sceneDir, site });
} else { scene = JSON.parse(fs.readFileSync(`${sceneDir}/scene.json`, 'utf8')); console.log(`reusing ${sceneDir}/scene.json (pass --recapture to refresh)`); }
lap('capture');

const brand = flags.brand || scene.meta?.siteName || (scene.title || host).split(/\s[|–—\-·:]\s/)[0].trim() || host;
let logoSrc = null;
if (flags.logo) { const ext = path.extname(flags.logo) || '.png'; fs.copyFileSync(flags.logo, `${sceneDir}/logo${ext}`); logoSrc = `${sceneDir}/logo${ext}`; }
else if (scene.icon) logoSrc = `${sceneDir}/${scene.icon}`;
const copy = (flags.line1 && flags.tail !== undefined) ? null : await endCopy(scene, { brand, log: console.log });
if (copy) console.log(`end-card copy (${copy.source}): ${copy.line1} / ${copy.tail}`);
const cfg = { brand, logoSrc, line1: flags.line1 || copy?.line1 || brand, tail: typeof flags.tail === 'string' ? flags.tail : (copy?.tail ?? ''),
  format: flags.format || '5:4', style: flags.style || 'default', duration: flags.duration ? +flags.duration : undefined, quality: +(flags.quality || 720) };
const FPS = +(flags.fps || 30), TRACK = typeof flags.track === 'string' ? flags.track : resolveMusic(flags.music);
const variant = [cfg.format !== '5:4' && cfg.format.replace(':', 'x'), `${cfg.quality}p${FPS}`, cfg.style !== 'default' && cfg.style, cfg.duration && cfg.duration + 's', flags.music].filter(Boolean).join('-');
if (flags['max-cruise']) cfg.maxCruise = +flags['max-cruise'];
console.log('end card', JSON.stringify(cfg));

fs.mkdirSync('out', { recursive: true });
const sdir = `out/${name}${variant ? '-' + variant : ''}-stills`; fs.rmSync(sdir, { recursive: true, force: true });

const rt = (i, tc) => i.SIG * (tc < 1.6 ? tc : tc < 7.3 ? 1.6 + (tc - 1.6) * i.K : tc + i.EXT);
const info = await stills(i => [0, 1.6, 2.5, 5, 6.5, 9.3, 11].map(tc => +rt(i, tc).toFixed(2)), { scene: sceneDir, cfg, out: sdir, sub: 8, log: () => {} });
spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-pattern_type', 'glob', '-i', `${sdir}/t*.png`, '-vf', 'scale=720:-1,tile=2x4:padding=8:color=white', '-frames:v', '1', `${sdir}/contact-sheet.jpg`]);
lap('stills'); console.log(`stills -> ${sdir}/contact-sheet.jpg  (duration ${info.DUR.toFixed(2)}s, cruise ${info.cruise.toFixed(0)} px/s, K ${info.K.toFixed(2)})`);

if (!flags['stills-only']) {
  const out = `out/${name}${variant ? '-' + variant : ''}.mp4`;
  let audio = null;
  if (!flags['no-sound']) { audio = out.replace(/\.mp4$/, '.wav'); await buildSound({ scene: sceneDir, cfg, out: audio, track: TRACK }); lap('sound'); }
  const r = await render({ out, fps: FPS, maxSub: +(flags['max-sub'] || 16), workers: +(flags.workers || 1), scene: sceneDir, cfg,
    audio, hw: !!flags.hw });
  lap('render');
}
console.log('timings (s, cumulative):', JSON.stringify(T, (k, v) => k === 'start' ? undefined : v));
