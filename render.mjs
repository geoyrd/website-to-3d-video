import { chromium } from 'playwright'; import { spawn } from 'child_process';
import http from 'http'; import { WebSocketServer } from 'ws'; import fs from 'fs'; import path from 'path'; import os from 'os';

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

export function startServer(sinks = {}) {
  const srv = http.createServer((q, s) => {
    const u = new URL(q.url, 'http://x');
    const f = path.join(ROOT, decodeURIComponent(u.pathname));
    if (!f.startsWith(ROOT)) { s.writeHead(403); s.end(); return; }
    fs.readFile(f, (e, b) => { if (e) { s.writeHead(404); s.end(); return; } s.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); s.end(b); });
  });

  const wss = new WebSocketServer({ server: srv, maxPayload: 64 << 20 });
  wss.on('connection', (ws, q) => {
    const sink = sinks[q.url.split('/').pop()];
    ws.on('message', buf => sink.write(buf, n => ws.send(String(n))));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

function ffSink(out, fps, i0, { audio, hw, W, H } = {}) {
  const args = ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'yuv420p', '-s', `${W}x${H}`, '-framerate', String(fps), '-i', '-'];
  if (audio) args.push('-i', audio);
  if (hw) args.push('-c:v', 'h264_videotoolbox', '-q:v', '72', '-allow_sw', '1');
  else args.push('-c:v', 'libx264', '-preset', 'slow', '-crf', fps >= 60 ? '14' : '20');
  args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (audio) args.push('-c:a', 'aac', '-b:a', '256k', '-shortest');
  args.push(out);
  const ff = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'inherit'] });
  const done = new Promise(r => ff.on('close', r));
  let n = i0;
  return {
    write(buf, ack) { n++; const k = n; if (ff.stdin.write(buf)) ack(k); else ff.stdin.once('drain', () => ack(k)); },
    end: () => { ff.stdin.end(); return done; },
  };
}

export async function render({ out = 'out/flyover.mp4', fps = 60, maxSub = 16, workers = 1, scene = 'capture', cfg = null, audio = null, hw = false, log = console.log } = {}) {
  const t0 = Date.now(); const sinks = {};
  const { srv, port } = await startServer(sinks);
  const qs = `?scene=${encodeURIComponent(scene)}` + (cfg ? '&cfg=' + encodeURIComponent(typeof cfg === 'string' ? cfg : JSON.stringify(cfg)) : '');
  const launch = () => chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });

  const b0 = await launch(); const p0 = await b0.newPage({ viewport: { width: 1440, height: 1152 } });
  p0.on('pageerror', e => log('[err]', e.message));
  await p0.goto(`http://127.0.0.1:${port}/film.html${qs}`); const info = await p0.evaluate(() => window.ready);
  const N = Math.round(info.DUR * fps); log(`scene ${scene} ${info.W}x${info.H}: ${info.PH}px page, cruise ${info.cruise.toFixed(0)} px/s, K ${info.K.toFixed(2)}, ${info.DUR.toFixed(2)}s = ${N} frames, ${workers} worker(s)`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flyover-'));
  const ranges = Array.from({ length: workers }, (_, w) => [Math.round(N * w / workers), Math.round(N * (w + 1) / workers)]);
  const segs = ranges.map((_, w) => workers === 1 ? out : path.join(tmp, `seg${w}.mp4`));
  let subs = 0;
  await Promise.all(ranges.map(async ([i0, i1], w) => {
    const b = w === 0 ? b0 : await launch(); const p = w === 0 ? p0 : await b.newPage({ viewport: { width: 1440, height: 1152 } });
    if (w) { p.on('pageerror', e => log('[err]', e.message)); await p.goto(`http://127.0.0.1:${port}/film.html${qs}`); await p.evaluate(() => window.ready); }
    sinks[w] = ffSink(segs[w], fps, i0, { audio: workers === 1 ? audio : null, hw, W: info.W, H: info.H });

    for (let a = i0; a < i1; a += 120) {
      const r = await p.evaluate(([a, z, fps, sink, ms]) => renderFrames(a, z, fps, sink, ms), [a, Math.min(i1, a + 120), fps, `ws://127.0.0.1:${port}/ws/${w}`, maxSub]);
      subs += r.subs; if (w === 0) log(`  w0 frame ${Math.min(i1, a + 120) - i0}/${i1 - i0}  ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    await sinks[w].end(); await b.close();
  }));
  if (workers > 1) {
    fs.writeFileSync(path.join(tmp, 'list.txt'), segs.map(s => `file '${s}'`).join('\n'));
    const args = ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt')];
    if (audio) args.push('-i', audio, '-c:a', 'aac', '-b:a', '256k', '-shortest');
    args.push('-c:v', 'copy', '-movflags', '+faststart', out);
    await new Promise(r => spawn('ffmpeg', args, { stdio: 'inherit' }).on('close', r));
  }
  fs.rmSync(tmp, { recursive: true, force: true }); srv.close();
  const secs = (Date.now() - t0) / 1000;
  log(`done ${out}  ${secs.toFixed(1)}s  (${N} frames, avg ${(subs / N).toFixed(1)} subframes/frame)`);
  return { out, secs, frames: N, avgSub: subs / N, info };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out = 'out/flyover.mp4', fps = 60, maxSub = 16] = process.argv.slice(2);
  await render({ out, fps: +fps, maxSub: +maxSub, workers: +(process.env.WORKERS || 1), scene: process.env.SCENE || 'capture',
    cfg: process.env.CFG || null, audio: process.env.AUDIO || null, hw: !!process.env.HW });
}
