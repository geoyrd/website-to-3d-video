import { chromium } from 'playwright'; import { startServer } from './render.mjs';
const fps = +process.argv[2] || 30;
const { srv, port } = await startServer();
const b = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] }); const p = await b.newPage();
await p.goto(`http://127.0.0.1:${port}/film.html?scene=${encodeURIComponent(process.env.SCENE || 'capture')}`); await p.evaluate(() => window.ready);
const out = await p.evaluate(fps => { const a = []; for (let i = 0; i < Math.round(window.duration * fps); i++) a.push(cameraAt(i / fps)); return a; }, fps);
const K = await p.evaluate(() => debug().K);
console.log(JSON.stringify({ K, cams: out })); await b.close(); srv.close();
