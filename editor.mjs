import http from 'http'; import fs from 'fs'; import path from 'path';
import { capture } from './capture.mjs'; import { stills } from './stills.mjs'; import { render } from './render.mjs';
import { buildSound } from './sound.mjs'; import { endCopy } from './copy.mjs'; import { library, resolveMusic } from './music.mjs';

const ROOT = path.dirname(new URL(import.meta.url).pathname); process.chdir(ROOT);
const PORT = +process.env.PORT || 5178;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.wav': 'audio/wav', '.webp': 'image/webp', '.ico': 'image/x-icon' };

const sceneName = url => { const host = new URL(url).hostname.replace(/^www\./, '');
  return host.replace(/\.(vercel\.app|netlify\.app|com|io|co|es|ro|net|org|app|dev|at|de)$/g, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase(); };
const siteFor = host => { for (const f of fs.existsSync('sites') ? fs.readdirSync('sites') : []) { if (!f.endsWith('.json') || f.startsWith('._')) continue;
  const j = JSON.parse(fs.readFileSync(`sites/${f}`, 'utf8')); if (j.match && host.endsWith(j.match)) return `sites/${f}`; } return null; };
const readScene = name => JSON.parse(fs.readFileSync(`scenes/${name}/scene.json`, 'utf8'));

const jobs = new Map(); let chain = Promise.resolve(), nextId = 1;
function job(kind, fn) {
  const j = { id: String(nextId++), kind, state: 'queued', log: [], result: null, error: null, t0: Date.now() };
  const log = (...a) => { const s = a.join(' '); if (s.startsWith('[page]')) return; j.log.push(s); if (j.log.length > 200) j.log.shift(); };
  jobs.set(j.id, j);
  chain = chain.then(async () => { j.state = 'running'; j.t0 = Date.now();
    try { j.result = await fn(log); j.state = 'done'; } catch (e) { j.error = e.message; j.state = 'error'; log('error: ' + e.message); }
    j.secs = (Date.now() - j.t0) / 1000; });
  return j;
}

function sceneSummary(name) {
  const s = readScene(name);
  return { name, url: s.url, H: s.H, title: s.title, meta: s.meta, icon: s.icon ? `scenes/${name}/${s.icon}` : null,
    pieces: s.pieces.map(p => ({ id: p.id, role: p.role, zone: p.zone, w: Math.round(p.w), h: Math.round(p.h), off: !!p.off, img: `scenes/${name}/${p.file}` })) };
}
function filmCfg(b) {
  return { brand: b.brand, logoSrc: b.logo || null, line1: b.line1 || '', tail: b.tail || '', format: b.format || '5:4', style: b.style || 'default',
    duration: b.duration ? +b.duration : undefined, quality: +(b.quality || 720) };
}
const variantOf = (c, fps, music) => [c.format.replace(':', 'x'), `${c.quality}p${fps}`, c.style !== 'default' && c.style, c.duration && c.duration + 's', music].filter(Boolean).join('-');

const api = {
  async music() { return library().map(t => ({ id: t.id, name: t.name, mood: t.mood, artist: t.artist, url: `music/${t.file}` })); },
  async capture(b) {
    const url = b.url.startsWith('http') ? b.url : 'https://' + b.url, name = sceneName(url);
    return job('capture', async log => {
      if (b.recapture || !fs.existsSync(`scenes/${name}/scene.json`)) await capture(url, { out: `scenes/${name}`, site: siteFor(new URL(url).hostname), log });
      else log('reusing the existing capture');
      const s = readScene(name);
      const brand = s.meta?.siteName || (s.title || '').split(/\s[|–—\-·:]\s/)[0].trim() || new URL(url).hostname;
      const copy = await endCopy(s, { brand, log });
      return { ...sceneSummary(name), brand, copy };
    });
  },
  async pieces(b) {
    const f = `scenes/${b.name}/scene.json`, s = readScene(b.name);
    for (const p of s.pieces) { const u = b.pieces.find(x => x.id === p.id); if (u) { if (u.off) p.off = true; else delete p.off; } }
    fs.writeFileSync(f, JSON.stringify(s, null, 1)); return { ok: true };
  },
  async preview(b) {
    const cfg = filmCfg(b), out = `out/${b.name}-preview`;
    return job('preview', async log => {
      fs.rmSync(out, { recursive: true, force: true });
      const rt = (i, tc) => i.SIG * (tc < 1.6 ? tc : tc < 7.3 ? 1.6 + (tc - 1.6) * i.K : tc + i.EXT);
      const info = await stills(i => [0.2, 2.5, 5, 9.3, 11.2].map(tc => +rt(i, tc).toFixed(2)), { scene: `scenes/${b.name}`, cfg, out, sub: 4, log });
      return { info: { DUR: info.DUR, W: info.W, H: info.H }, images: fs.readdirSync(out).filter(f => f.endsWith('.png') && !f.startsWith('._')).sort().map(f => `${out}/${f}?v=${Date.now()}`) };
    });
  },
  async render(b) {
    const cfg = filmCfg(b), fps = +(b.fps || 30), track = b.track || resolveMusic(b.music);
    const out = `out/${b.name}-${variantOf(cfg, fps, b.sound === false ? 'mute' : b.track ? 'custom' : b.music || 'fx')}.mp4`;
    return job('render', async log => {
      let audio = null;
      if (b.sound !== false) { audio = out.replace(/\.mp4$/, '.wav'); await buildSound({ scene: `scenes/${b.name}`, cfg, out: audio, track, log }); }
      const r = await render({ out, fps, maxSub: 16, scene: `scenes/${b.name}`, cfg, audio, log });
      return { video: `${out}?v=${Date.now()}`, secs: r.secs, frames: r.frames };
    });
  },
};

async function upload(q, s, kind, filename) {
  fs.mkdirSync('uploads', { recursive: true });
  const ext = path.extname(filename || '').toLowerCase().replace(/[^.a-z0-9]/g, '') || (kind === 'logo' ? '.png' : '.mp3');
  const f = `uploads/${kind}-${Date.now()}${ext}`; const ws = fs.createWriteStream(f);
  q.pipe(ws); await new Promise(r => ws.on('finish', r));
  s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify({ path: f }));
}

http.createServer(async (q, s) => {
  const u = new URL(q.url, 'http://x');
  try {

    if (u.pathname === '/' || u.pathname.startsWith('/assets/') || u.pathname === '/favicon.svg') u.pathname = '/chat/dist' + (u.pathname === '/' ? '/index.html' : u.pathname);
    if (u.pathname.startsWith('/api/upload/')) return upload(q, s, u.pathname.split('/').pop(), u.searchParams.get('name'));
    if (u.pathname.startsWith('/api/job/')) { const j = jobs.get(u.pathname.split('/').pop());
      s.writeHead(j ? 200 : 404, { 'content-type': 'application/json' }); s.end(JSON.stringify(j ? { ...j, elapsed: (Date.now() - j.t0) / 1000 } : {})); return; }
    if (u.pathname.startsWith('/api/') && q.method === 'POST') {
      let body = ''; for await (const c of q) body += c; const b = JSON.parse(body || '{}');
      const key = u.pathname.slice(5), fn = api[key]; if (!fn) { s.writeHead(404); s.end(); return; }
      const r = await fn(b); s.writeHead(200, { 'content-type': 'application/json' }); s.end(JSON.stringify(r)); return;
    }
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); s.end(); return; }

    const st = fs.statSync(f), type = TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream', range = q.headers.range;
    if (range) { const [a, z] = range.replace('bytes=', '').split('-'); const start = +a, end = z ? +z : st.size - 1;
      s.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${st.size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      fs.createReadStream(f, { start, end }).pipe(s); return; }
    s.writeHead(200, { 'content-type': type, 'content-length': st.size, 'accept-ranges': 'bytes', 'cache-control': 'no-store' }); fs.createReadStream(f).pipe(s);
  } catch (e) { s.writeHead(500, { 'content-type': 'application/json' }); s.end(JSON.stringify({ error: e.message })); }
}).listen(PORT, '127.0.0.1', () => console.log(`website-to-3d-video: http://localhost:${PORT}`));
