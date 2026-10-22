import { chromium } from 'playwright'; import fs from 'fs'; import { startServer } from './render.mjs';
export async function stills(times, { scene = 'capture', cfg = null, out = 'stills', sub = 8, log = console.log } = {}) {
  const { srv, port } = await startServer();
  const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const p = await b.newPage({ viewport: { width: 1440, height: 1152 } });
  p.on('console', m => log('[page]', m.text())); p.on('pageerror', e => log('[err]', e.message));
  const qs = `?scene=${encodeURIComponent(scene)}` + (cfg ? '&cfg=' + encodeURIComponent(typeof cfg === 'string' ? cfg : JSON.stringify(cfg)) : '');
  await p.goto(`http://127.0.0.1:${port}/film.html${qs}`);
  const info = await p.evaluate(() => window.ready); log(JSON.stringify(info)); await p.setViewportSize({ width: info.W, height: info.H }); if (process.env.NODOF) await p.evaluate(() => window.NODOF = true);
  fs.mkdirSync(out, { recursive: true });
  if (typeof times === 'function') times = times(info);
  for (const t of times) {
    const t0 = Date.now(); const s = await p.evaluate(([t, s]) => seek(t, s), [t, sub]);
    await p.screenshot({ path: `${out}/t${t.toFixed(2).padStart(5, '0')}.png`, clip: { x: 0, y: 0, width: info.W, height: info.H } });
    log(t, 'sub', s, JSON.stringify(await p.evaluate(t => cameraAt(t), t)), Date.now() - t0 + 'ms');
  }
  await b.close(); srv.close(); return info;
}
if (import.meta.url === `file://${process.argv[1]}`) {
  const sub = process.env.SUB === 'auto' ? 'auto' : +(process.env.SUB || 8);
  await stills(process.argv.slice(2).map(Number), { scene: process.env.SCENE || 'capture', cfg: process.env.CFG, out: process.env.OUT || 'stills', sub });
}
