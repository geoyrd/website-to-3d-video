import { chromium } from 'playwright'; import { spawn, spawnSync } from 'child_process'; import fs from 'fs'; import path from 'path'; import os from 'os';
import { startServer } from './render.mjs';

const SR = 48000;

export async function cueSheet({ scene, cfg }) {
  const { srv, port } = await startServer();
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage();
  const qs = `?scene=${encodeURIComponent(scene)}` + (cfg ? '&cfg=' + encodeURIComponent(JSON.stringify(cfg)) : '');
  await p.goto(`http://127.0.0.1:${port}/film.html${qs}`); await p.evaluate(() => window.ready);
  const cues = await p.evaluate(() => audioCues(100));
  await b.close(); srv.close(); return cues;
}

let seed = 1234567;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

function svf() { let lp = 0, bp = 0; return (x, fc, q) => { const f = 2 * Math.sin(Math.PI * Math.min(fc, SR / 6) / SR); const hp = x - lp - q * bp; bp += f * hp; lp += f * bp; return { lp, bp, hp }; }; }
const env1 = (t, a, d) => t < 0 ? 0 : t < a ? t / a : Math.exp(-(t - a) / d);

function reverb(len, mix = 0.18) {
  const combs = [1557, 1617, 1491, 1422].map(n => ({ buf: new Float32Array(n), i: 0, fb: 0.80 }));
  const aps = [225, 556].map(n => ({ buf: new Float32Array(n), i: 0 }));
  return x => { let y = 0;
    for (const c of combs) { const o = c.buf[c.i]; c.buf[c.i] = x + o * c.fb; c.i = (c.i + 1) % c.buf.length; y += o; }
    y *= 0.25; for (const a of aps) { const o = a.buf[a.i]; const v = y + o * 0.5; a.buf[a.i] = v; a.i = (a.i + 1) % a.buf.length; y = o - 0.5 * v; }
    return x * (1 - mix) + y * mix; };
}

function synthEffects(cues) {
  const N = Math.ceil(cues.dur * SR) + SR, L = new Float32Array(N), R = new Float32Array(N);

  const envAt = t => { const f = t * cues.rate, i = Math.floor(f); const a = cues.env[i] || 0, b = cues.env[i + 1] || a; return a + (b - a) * (f - i); };
  const peak = Math.max(...cues.env.slice(0, Math.floor((cues.hit - 0.3) * cues.rate)), 1e-3);
  const fL = svf(), fR = svf(), low = svf(); let sm = 0;
  for (let i = 0; i < N; i++) {
    const t = i / SR, v = Math.min(1.4, envAt(t) / peak); sm += (v - sm) * 0.0004;
    const fc = 220 + 1500 * Math.pow(sm, 0.75), g = 0.24 * Math.pow(sm, 0.9);
    const n0 = rnd(), nl = 0.7 * n0 + 0.3 * rnd(), nr = 0.7 * n0 + 0.3 * rnd();
    L[i] += fL(nl, fc, 0.9).bp * g; R[i] += fR(nr, fc * 1.04, 0.9).bp * g;
    const r = low(n0, 110, 1.2).lp * 0.22 * sm; L[i] += r; R[i] += r;
  }

  const fx = new Float32Array(N), fxR = new Float32Array(N);
  const put = (i, l, r) => { if (i >= 0 && i < N) { fx[i] += l; fxR[i] += r; } };
  for (const e of cues.events) {
    const i0 = Math.round(e.t * SR), pan = e.pan || 0, pl = Math.cos((pan + 1) * Math.PI / 4), pr = Math.sin((pan + 1) * Math.PI / 4);
    if (e.type === 'lift' || e.type === 'tile') {
      const f0 = (e.type === 'tile' ? 2600 : 1900) * (1 + rnd() * 0.06), d = 0.028, g = 0.09 * e.gain;
      for (let k = 0; k < SR * 0.18; k++) { const t = k / SR, a = env1(t, 0.0015, d) * g;
        const x = a * (Math.sin(2 * Math.PI * f0 * t) + 0.35 * Math.sin(2 * Math.PI * f0 * 2.76 * t)); put(i0 + k, x * pl * 1.4, x * pr * 1.4); }
    } else if (e.type === 'whooshUp' || e.type === 'whooshDown') {
      const up = e.type === 'whooshUp', pre = 0.75, post = 0.35, f = svf(), f2 = svf();
      for (let k = -Math.round(pre * SR); k < post * SR; k++) { const t = k / SR, u = (t + pre) / (pre + post);
        const a = t < 0 ? Math.pow(1 + t / pre, 2.2) : Math.exp(-t / 0.12);
        const fc = up ? 300 + 3200 * u * u : 3400 - 2800 * u;
        const n = rnd(), x = (f(n, fc, 0.6).bp + 0.5 * f2(rnd(), fc * 0.5, 0.7).bp) * a * 0.42;
        const pn = up ? -0.7 + 1.4 * u : 0.7 - 1.4 * u, ql = Math.cos((pn + 1) * Math.PI / 4), qr = Math.sin((pn + 1) * Math.PI / 4);
        put(i0 + k, x * ql * 1.4, x * qr * 1.4); }
    } else if (e.type === 'hit') {
      for (let k = 0; k < SR * 3.2; k++) { const t = k / SR;
        const fsub = 42 + 18 * Math.exp(-t / 0.08), phs = 2 * Math.PI * (42 * t + 18 * 0.08 * (1 - Math.exp(-t / 0.08)));
        let x = Math.sin(phs) * env1(t, 0.004, 0.55) * 0.85 + Math.sin(2 * Math.PI * 138 * t) * env1(t, 0.002, 0.09) * 0.25;
        if (t < 0.012) x += rnd() * (1 - t / 0.012) * 0.35;
        void fsub; put(i0 + k, x, x); }
    } else if (e.type === 'badge') {
      for (let k = 0; k < SR * 0.12; k++) { const t = k / SR, f0 = 900 - 260 * Math.min(1, t / 0.05);
        const x = Math.sin(2 * Math.PI * f0 * t) * env1(t, 0.003, 0.035) * 0.08; put(i0 + k, x, x); }
    } else if (e.type === 'word') {
      for (let k = 0; k < SR * 0.05; k++) { const t = k / SR; const x = Math.sin(2 * Math.PI * 3300 * t) * env1(t, 0.001, 0.010) * 0.035;
        put(i0 + k, x * pl * 1.4, x * pr * 1.4); }
    }
  }
  const rvL = reverb(N, 0.2), rvR = reverb(N, 0.2);
  for (let i = 0; i < N; i++) { L[i] += rvL(fx[i]); R[i] += rvR(fxR[i]); }
  return { L, R, fx, fxR, N };
}

function decode(file, sr, ch) {
  const r = spawnSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-f', 'f32le', '-ac', String(ch), '-ar', String(sr), '-'], { maxBuffer: 1 << 30 });
  if (r.status !== 0) throw new Error('cannot decode ' + file + ': ' + r.stderr);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.length / 4);
}
export function beatGrid(file) {
  const sr = 11025, x = decode(file, sr, 1), hop = 256, win = 1024, n = Math.floor((x.length - win) / hop);

  const e = new Float32Array(n), lo = new Float32Array(n); let lp = 0;
  for (let i = 0; i < n; i++) { let s = 0, sl = 0; for (let k = 0; k < win; k++) { const v = x[i * hop + k]; s += v * v; lp += 0.05 * (v - lp); sl += lp * lp; }
    e[i] = Math.log(1e-6 + s); lo[i] = Math.log(1e-6 + sl); }
  const on = new Float32Array(n); for (let i = 1; i < n; i++) on[i] = Math.max(0, e[i] - e[i - 1]) + 1.5 * Math.max(0, lo[i] - lo[i - 1]);
  const fps = sr / hop;

  let best = 0, bestLag = 0;
  for (let bpm = 70; bpm <= 180; bpm += 0.1) { const lag = 60 * fps / bpm; let s = 0;
    for (let i = Math.ceil(lag); i < n; i++) { const j = i - lag, j0 = Math.floor(j); s += on[i] * (on[j0] + (on[j0 + 1] - on[j0]) * (j - j0)); }
    s *= Math.exp(-Math.pow(Math.log2(bpm / 120), 2) * 0.6); if (s > best) { best = s; bestLag = lag; } }

  let bp = 0, bpS = -1; for (let ph = 0; ph < bestLag; ph += 0.25) { let s = 0; for (let t = ph; t < n; t += bestLag) s += on[Math.round(t)] || 0; if (s > bpS) { bpS = s; bp = ph; } }

  const tOf = i => (i * hop + win) / sr;

  const pts = []; for (let k = 0, t = bp; t < n; k++, t += bestLag) {
    const c = Math.round(t), r = Math.round(0.06 * fps); let bi = c, bv = -1;
    for (let i = Math.max(1, c - r); i <= Math.min(n - 1, c + r); i++) if (on[i] > bv) { bv = on[i]; bi = i; }
    if (bv > 0) pts.push([k, tOf(bi), bv]); }
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0; for (const [k, t, w] of pts) { sw += w; sx += w * k; sy += w * t; sxx += w * k * k; sxy += w * k * t; }
  const period = (sw * sxy - sx * sy) / (sw * sxx - sx * sx), t0b = (sy - period * sx) / sw;
  const beats = []; for (let k = 0; t0b + k * period < x.length / sr; k++) if (t0b + k * period >= 0) beats.push(t0b + k * period);
  bestLag = period * fps;
  const barS = [0, 0, 0, 0]; beats.forEach((b, i) => { const k = Math.round((b * sr - win) / hop); let m = 0; for (let j = k - 2; j <= k + 2; j++) m = Math.max(m, lo[j] || -99); barS[i % 4] += m; });
  const bar = barS.indexOf(Math.max(...barS));
  const rms = t => { const a = Math.floor((t * sr - win) / hop), z = Math.min(n, a + Math.round(4 * fps)); let s = 0; for (let i = a; i < z; i++) s += Math.exp(e[i]); return s / Math.max(1, z - a); };
  return { bpm: 60 * fps / bestLag, beats, downbeats: beats.filter((_, i) => i % 4 === bar), dur: x.length / sr, rms };
}

function writeWav(file, L, R) {
  const n = L.length, buf = Buffer.alloc(44 + n * 8);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 8, 4); buf.write('WAVE', 8); buf.write('fmt ', 12); buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(3, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 8, 28); buf.writeUInt16LE(8, 32); buf.writeUInt16LE(32, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 8, 40);
  for (let i = 0; i < n; i++) { buf.writeFloatLE(L[i], 44 + i * 8); buf.writeFloatLE(R[i], 48 + i * 8); }
  fs.writeFileSync(file, buf);
}

export async function buildSound({ scene, cfg, out, track = null, log = console.log }) {
  const t0 = Date.now();
  const cues = await cueSheet({ scene, cfg });
  const fxMix = synthEffects(cues);
  const N = Math.ceil(cues.dur * SR), L = fxMix.L.slice(0, N), R = fxMix.R.slice(0, N);
  let note = 'effects only';
  if (track) {
    const g = beatGrid(track);

    const cand = g.downbeats.filter(b => b >= cues.hit && b - cues.hit + cues.dur <= g.dur);
    const pick = (cand.length ? cand : [cues.hit]).reduce((a, b) => (g.rms(b) > g.rms(a) ? b : a));
    const off = Math.max(0, pick - cues.hit);
    const m = decode(track, SR, 2);

    let fol = 0;
    for (let i = 0; i < N; i++) {
      const s = Math.abs(fxMix.fx[i] || 0) + Math.abs(fxMix.fxR[i] || 0); fol = s > fol ? fol + (s - fol) * 0.02 : fol * 0.99985;
      const duck = 1 - 0.45 * Math.min(1, fol * 3), t = i / SR;
      const fade = Math.min(1, t / 0.4) * Math.min(1, (cues.dur - t) / 1.8);
      const j = Math.round((off + t) * SR) * 2, gm = 0.55 * duck * Math.max(0, fade);
      L[i] += (m[j] || 0) * gm; R[i] += (m[j + 1] || 0) * gm;
    }
    note = `music ${path.basename(track)}: ${g.bpm.toFixed(1)} bpm, offset ${off.toFixed(2)}s so a downbeat hits ${cues.hit.toFixed(2)}s`;
  }
  const tmp = path.join(os.tmpdir(), `flyover-mix-${process.pid}.wav`); writeWav(tmp, L, R);

  const target = track ? -14 : -16;
  await new Promise((res, rej) => spawn('ffmpeg', ['-y', '-loglevel', 'error', '-i', tmp, '-af', `loudnorm=I=${target}:TP=-1.0:LRA=11`, '-ar', String(SR), '-c:a', 'pcm_s16le', out],
    { stdio: 'inherit' }).on('close', c => c ? rej(new Error('loudnorm failed')) : res()));
  fs.rmSync(tmp, { force: true });
  log(`sound -> ${out} (${note}, ${cues.events.length} cues, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  return { out, cues };
}
