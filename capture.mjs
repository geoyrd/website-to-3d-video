import { chromium } from 'playwright';
import fs from 'fs'; import path from 'path';

export async function capture(url, { out = 'capture', site = null, log = console.log } = {}) {
  const S = site ? JSON.parse(fs.readFileSync(site, 'utf8')) : {};
  const VW = 1440, VH = 900, PAD = 28, CHUNK = 4096;
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(path.join(out, 'layers'), { recursive: true });

  const GPU = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  const b = await chromium.launch({ channel: process.env.CAPTURE_CHANNEL ?? 'chrome', args: GPU }).catch(() => chromium.launch({ args: GPU }));
  let scale = 2;
  const ctx = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
  let p = await ctx.newPage();
  const t0 = Date.now();
  await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => p.waitForLoadState('load'));
  await settle(p, S);
  let H = await p.evaluate(() => document.documentElement.scrollHeight);
  if (H > 10000) {
    scale = 1.5; await ctx.close();
    const c2 = await b.newContext({ viewport: { width: VW, height: VH }, deviceScaleFactor: scale, reducedMotion: 'reduce' });
    p = await c2.newPage(); await p.goto(url, { waitUntil: 'networkidle', timeout: 60000 }).catch(() => p.waitForLoadState('load'));
    await settle(p, S); H = await p.evaluate(() => document.documentElement.scrollHeight);
  }
  log(`settled ${((Date.now() - t0) / 1000).toFixed(1)}s, page ${H}px, scale ${scale}`);

  const scene = await p.evaluate(detect, { S, PAD });
  Object.assign(scene, { url, scale, width: VW, pad: PAD }, S.scene || {});
  for (const pc of scene.pieces) log(`  ${pc.role.padEnd(11)} ${pc.zone.padEnd(5)} ${pc.id.padEnd(16)} ${Math.round(pc.x)},${Math.round(pc.y)} ${Math.round(pc.w)}x${Math.round(pc.h)}`);

  await p.addStyleTag({ content: `[data-layer]{visibility:hidden!important}` });
  H = await p.evaluate(() => document.documentElement.scrollHeight);
  const step = CHUNK / scale; scene.chunks = [];
  for (let i = 0, y = 0; y < H; i++, y += step) {
    const h = Math.min(step, H - y);
    await p.screenshot({ path: path.join(out, `page_${i}.png`), fullPage: true, clip: { x: 0, y, width: VW, height: h } });
    scene.chunks.push({ file: `page_${i}.png`, y0: y, h });
  }
  scene.H = H;

  await p.addStyleTag({ content: `html,body{background:transparent!important}` });
  for (const pc of scene.pieces) {
    const t = pc.role === 'testimonial' && pc.boxed;
    const pad = pc.pad = PAD + (t ? 40 : 0);
    await p.evaluate(({ id, t }) => {
      let s = document.getElementById('__solo'); if (!s) { s = document.createElement('style'); s.id = '__solo'; document.head.appendChild(s); }
      s.textContent = `body *{visibility:hidden!important} [data-layer="${id}"],[data-layer="${id}"] *{visibility:visible!important}
        [data-layer="${id}"] [data-layer],[data-layer="${id}"] [data-layer] *{visibility:hidden!important}
        [data-layer="${id}"]{${t ? 'background:#fff!important;box-shadow:0 0 0 34px #fff!important;border-radius:22px!important;' : ''}}`;
    }, { id: pc.id, t });
    const clip = { x: Math.max(0, pc.x - pad), y: Math.max(0, pc.y - pad), width: pc.w + 2 * pad, height: pc.h + 2 * pad };
    clip.width = Math.min(clip.width, VW - clip.x);
    pc.ox = pc.x - clip.x; pc.oy = pc.y - clip.y;
    await p.screenshot({ path: path.join(out, 'layers', `${pc.id}.png`), fullPage: true, omitBackground: true, clip });
    pc.file = `layers/${pc.id}.png`; pc.lw = clip.width; pc.lh = clip.height;
  }

  for (const ic of scene.meta.icons.slice(0, 3)) {
    try { const r = await p.request.get(ic.href, { timeout: 4000 }); const ct = r.headers()['content-type'] || '';
      if (!r.ok() || !/png|jpe?g|svg|webp/.test(ct)) continue; const ext = ct.includes('svg') ? 'svg' : ct.includes('jp') ? 'jpg' : ct.includes('webp') ? 'webp' : 'png';
      fs.writeFileSync(path.join(out, `icon.${ext}`), await r.body()); scene.icon = `icon.${ext}`; break; } catch {}
  }
  fs.writeFileSync(path.join(out, 'scene.json'), JSON.stringify(scene, null, 1));
  await b.close();
  log(`capture done ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${out}/scene.json (${scene.pieces.length} pieces, ${scene.chunks.length} chunks)`);
  return scene;
}

async function settle(p, S) {
  await p.addStyleTag({ content: `*,*::before,*::after{transition:none!important;animation-duration:0s!important;animation-delay:0s!important;
      animation-iteration-count:1!important;scroll-behavior:auto!important;caret-color:transparent!important;content-visibility:visible!important}
    html{scroll-behavior:auto!important}` });
  await hideBanners(p);

  let H = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < H + 900; y += 450) {
    await p.evaluate(y => scrollTo(0, y), y); await p.waitForTimeout(90);
    if (y > H - 900) H = await p.evaluate(() => document.documentElement.scrollHeight);
  }
  await p.waitForTimeout(900); await p.evaluate(() => scrollTo(0, 0)); await p.waitForTimeout(400);
  await p.evaluate(async () => {
    document.querySelectorAll('img[loading=lazy]').forEach(i => i.loading = 'eager');
    document.querySelectorAll('img[data-src]').forEach(i => { if (!i.src || i.src.startsWith('data:')) i.src = i.dataset.src; });
    await Promise.race([Promise.all([...document.images].map(i => i.decode().catch(() => {}))), new Promise(r => setTimeout(r, 8000))]);
    await document.fonts.ready;
  });
  await hideBanners(p);
  await freezeMedia(p);
  if (process.env.NOCAR) await p.evaluate(() => { window.__noCar = 1; });
  await p.evaluate(flatten);
  if (process.env.DEBUGCAR) console.log(await p.evaluate(() => [...document.querySelectorAll('[data-flat-carousel]')].map(e => e.className + ' -> grid: ' + [...e.querySelectorAll('*')].filter(x => x.style.getPropertyValue('display') === 'grid').map(x => x.className.toString().slice(0, 60)).join(' | ')).join('\n')));
  if (S.css) await p.addStyleTag({ content: S.css });
  if (S.exclude) await p.addStyleTag({ content: S.exclude.join(',') + '{display:none!important}' });
  await p.waitForTimeout(500);
  await p.evaluate(() => document.querySelectorAll('video').forEach(v => { try { v.pause(); } catch {} }));
}

async function freezeMedia(p) {
  await p.evaluate(async () => {
    document.querySelectorAll('iframe[loading=lazy]').forEach(f => f.loading = 'eager');
    const vids = [...document.querySelectorAll('video')];
    await Promise.all(vids.map(async v => {
      try { v.muted = true; v.preload = 'auto'; if (v.readyState < 2) { v.load(); await v.play().catch(() => {}); }
        await new Promise(r => { if (v.readyState >= 2) r(); else { v.addEventListener('loadeddata', r, { once: true }); setTimeout(r, 4000); } });
        if (v.readyState >= 2 && v.duration > 1.2) { v.currentTime = Math.min(1, v.duration / 3); await new Promise(r => { v.addEventListener('seeked', r, { once: true }); setTimeout(r, 1500); }); }
        v.pause();
      } catch {}
      if (v.readyState < 2 || !v.videoWidth) {
        const r = v.getBoundingClientRect(), img = document.createElement('img');
        img.style.cssText = getComputedStyle(v).cssText; img.style.width = r.width + 'px'; img.style.height = r.height + 'px'; img.style.objectFit = getComputedStyle(v).objectFit || 'cover';
        if (v.poster) { img.src = v.poster; v.replaceWith(img); await img.decode().catch(() => {}); }
        else v.style.setProperty('background', '#d9dce1', 'important');
      }
    }));
  });
  await p.waitForTimeout(300);
}

async function hideBanners(p) {
  await p.evaluate(() => {
    const RX = /cookie|consent|gdpr|cmp|onetrust|didomi|cookiebot|usercentrics|privacy-banner|termly|iubenda|klaro|osano|quantcast/i;
    for (const e of document.querySelectorAll('body *')) {
      const id = (e.id || '') + ' ' + (typeof e.className === 'string' ? e.className : '') + ' ' + (e.getAttribute('aria-label') || '');
      if (!RX.test(id)) continue;
      const cs = getComputedStyle(e);
      if (cs.position === 'fixed' || cs.position === 'sticky' || e.getAttribute('role') === 'dialog' || /banner|dialog|modal|overlay|popup/i.test(id))
        e.style.setProperty('display', 'none', 'important');
    }

    for (const e of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(e); if (cs.position !== 'fixed') continue;
      const r = e.getBoundingClientRect();
      const dialog = e.getAttribute('role') === 'dialog' || e.getAttribute('aria-modal') === 'true';
      if (dialog || (r.width * r.height > 0.6 * innerWidth * innerHeight && +cs.zIndex > 10)) e.style.setProperty('display', 'none', 'important');
      if (r.top > innerHeight * 0.5 && r.height < 220 && /accept|aceptar|cookies|agree|consent/i.test(e.innerText || '')) e.style.setProperty('display', 'none', 'important');
    }
    document.documentElement.style.setProperty('overflow', 'visible', 'important'); document.body.style.setProperty('overflow', 'visible', 'important');
  });
}

function flatten() {
  const VW = innerWidth, VH = innerHeight, all = [...document.querySelectorAll('body *')];
  const set = (e, k, v) => e.style.setProperty(k, v, 'important');
  const pureTranslate = tf => { if (!tf || tf === 'none') return null; const m = tf.match(/^matrix\(([^)]+)\)$/); if (!m) return null;
    const v = m[1].split(',').map(Number); return Math.abs(v[0] - 1) < 1e-3 && Math.abs(v[3] - 1) < 1e-3 && Math.abs(v[1]) < 1e-3 && Math.abs(v[2]) < 1e-3 ? [v[4], v[5]] : null; };
  const REVEAL = /reveal|fade|anim|aos|inview|in-view|appear|motion|split|char|word|line|slide-?up|scroll/i;

  for (const e of all) {
    const cs = getComputedStyle(e), cls = (typeof e.className === 'string' ? e.className : '') + ' ' + [...e.attributes].map(a => a.name).join(' ');
    if (e.closest('[aria-hidden=true]') && !e.querySelector('img')) continue;
    const marked = REVEAL.test(cls) || e.hasAttribute('data-aos') || e.hasAttribute('data-scroll');
    if (+cs.opacity < 1 && e.tagName !== 'OPTION' && (marked || +cs.opacity < 0.05 || e.getBoundingClientRect().width > 0)) set(e, 'opacity', '1');
    const tr = pureTranslate(cs.transform);
    if (tr && (tr[0] || tr[1])) {
      const par = e.parentElement, pcs = par && getComputedStyle(par);
      const masked = pcs && (pcs.overflow === 'hidden' || pcs.overflowY === 'hidden' || pcs.clipPath !== 'none');
      if (marked || masked || (Math.abs(tr[1]) > 0 && Math.abs(tr[1]) < 200 && !tr[0])) set(e, 'transform', 'none');
    } else if (cs.transform !== 'none' && marked && !/rotate/i.test(e.style.transform)) {
      const m = cs.transform.match(/^matrix\(([^)]+)\)$/); if (m) { const v = m[1].split(',').map(Number); if (Math.abs(v[1]) < 1e-3) set(e, 'transform', 'none'); }
    }
    if (marked && cs.clipPath !== 'none' && cs.clipPath) set(e, 'clip-path', 'none');
    if (marked && cs.filter && /blur/.test(cs.filter)) set(e, 'filter', 'none');
    if (cs.visibility === 'hidden' && marked) set(e, 'visibility', 'visible');
  }

  for (const a of document.querySelectorAll('a[href^="#"], a.skip-link, [class*=skip]')) if (/^\s*skip to|^\s*saltar al|^\s*sari la/i.test(a.innerText || '')) set(a, 'display', 'none');

  for (const e of all) {
    const cs = getComputedStyle(e);
    if (cs.position === 'fixed') {
      const r = e.getBoundingClientRect();
      if (r.top < 140 && r.width > VW * 0.5) set(e, 'position', 'absolute');
      else set(e, 'display', 'none');
    }
  }

  for (const e of all) {
    const cs = getComputedStyle(e); if (cs.position !== 'sticky') continue;
    const par = e.parentElement; const ph = par ? par.getBoundingClientRect().height : 0, eh = e.getBoundingClientRect().height;
    set(e, 'position', 'relative'); set(e, 'top', 'auto');
    if (par && ph > eh * 1.6 && eh >= VH * 0.6) { set(par, 'height', 'auto'); set(par, 'min-height', '0'); }

    for (const t of e.querySelectorAll('*')) {
      const r = t.getBoundingClientRect(), tcs = getComputedStyle(t);
      if (r.width > VW * 1.3 && t.children.length >= 3 && (tcs.display.includes('flex') || tcs.transform !== 'none')) { gridify(t); break; }
    }
  }

  for (const e of all) {
    const cs = getComputedStyle(e);
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && e.scrollWidth > e.clientWidth * 1.3 && e.children.length >= 3 && e.clientWidth > 300) gridify(e);
  }
  function gridify(t) {
    const kids = [...t.children].filter(k => getComputedStyle(k).display !== 'none');
    const cols = Math.min(4, kids.length);
    set(t, 'transform', 'none'); set(t, 'translate', 'none'); set(t, 'width', '100%'); set(t, 'max-width', '100%');
    set(t, 'display', 'grid'); set(t, 'grid-template-columns', `repeat(${cols},minmax(0,1fr))`); set(t, 'gap', '24px');
    set(t, 'overflow', 'visible'); set(t, 'position', 'relative'); set(t, 'left', '0'); set(t, 'height', 'auto'); set(t, 'box-sizing', 'border-box');
    for (const k of kids) { set(k, 'width', 'auto'); set(k, 'min-width', '0'); set(k, 'transform', 'none'); set(k, 'flex', 'none'); }
  }

  const CAR = /carousel|slider|swiper|slick|splide|glide|embla|keen-slider|flickity|owl-/i;
  for (const c of window.__noCar ? [] : document.querySelectorAll('[class], [aria-roledescription=carousel]')) {
    const cls = (typeof c.className === 'string' ? c.className : '') + ' ' + (c.getAttribute('aria-roledescription') || '');
    if (!CAR.test(cls) || c.closest('[data-flat-carousel]')) continue;
    const cr = c.getBoundingClientRect(); if (cr.width < 600) continue;

    let track = null;
    const SLIDE = /slide|item|card|plan|cell|panel|tile/i, TEXTY = /^(LI|P|SPAN|A|BUTTON|SVG|IMG|SOURCE|BR|STRONG|EM)$/;
    for (const t of [c, ...c.querySelectorAll('*')]) {
      const kids = [...t.children].filter(k => !/^(SCRIPT|STYLE|TEMPLATE)$/.test(k.tagName) && getComputedStyle(k).position !== 'absolute'); if (kids.length < 2) continue;
      const tag = kids[0].tagName; if (kids.filter(k => k.tagName === tag).length < kids.length * 0.7) continue;

      const key = k => (typeof k.className === 'string' && k.className.trim().split(/\s+/)[0]) || k.tagName;
      const cnt = {}; kids.forEach(k => cnt[key(k)] = (cnt[key(k)] || 0) + 1);
      if (Math.max(...Object.values(cnt)) < Math.max(2, kids.length * 0.7)) continue;
      const slideLike = kids.filter(k => SLIDE.test(typeof k.className === 'string' ? k.className : '')).length >= kids.length * 0.5;
      if (TEXTY.test(tag.toUpperCase()) && !slideLike) continue;
      const wide = kids.filter(k => { const r = k.getBoundingClientRect(); return r.width >= 180 || r.width === 0; }).length;
      if (wide < 2 && !slideLike) continue;

      const vis = kids.map(k => k.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
      const stacked = vis.length >= 2 && vis.every(r => Math.abs(r.left - vis[0].left) < 12) && vis.length === kids.length;
      if (stacked) continue;
      track = t; break;
    }
    if (!track) continue;
    const kids = [...track.children]; const big = kids.filter(k => { const r = k.getBoundingClientRect(); return r.width >= 180 || r.width === 0; });
    if (big.length < 2) continue;
    c.setAttribute('data-flat-carousel', '');
    const uniq = kids.filter(k => !k.classList.contains('swiper-slide-duplicate') && !k.classList.contains('slick-cloned') && !(k.getAttribute('aria-hidden') === 'true' && kids.length > 6 && k.matches('[class*=clone],[class*=duplicate]')));
    const shownDisp = (uniq.map(k => getComputedStyle(k).display).find(d => d !== 'none')) || 'block';
    uniq.forEach(k => { if (getComputedStyle(k).display === 'none') set(k, 'display', shownDisp); set(k, 'opacity', '1'); set(k, 'visibility', 'visible'); set(k, 'position', 'relative');
      set(k, 'left', 'auto'); set(k, 'top', 'auto'); set(k, 'inset', 'auto'); set(k, 'transform', 'none'); });
    kids.filter(k => !uniq.includes(k)).forEach(k => set(k, 'display', 'none'));
    for (let x = track; x && x !== c.parentElement; x = x.parentElement) { set(x, 'overflow', 'visible'); set(x, 'height', 'auto'); set(x, 'max-height', 'none'); }
    gridify(track);

    c.querySelectorAll('[class*=arrow],[class*=prev],[class*=next],[class*=dots],[class*=pagination],[class*=bullet],button[aria-label*=slide i]').forEach(e => { if (!e.contains(track)) set(e, 'display', 'none'); });
  }

  for (const e of document.querySelectorAll('section,[class*=section]')) {
    const r = e.getBoundingClientRect(); const inner = [...e.children].reduce((m, c) => Math.max(m, c.getBoundingClientRect().bottom - r.top), 0);
    if (r.height > VH * 2.2 && inner > 0 && inner < r.height * 0.55) { set(e, 'height', 'auto'); set(e, 'min-height', '0'); }
  }
}

function detect({ S, PAD }) {
  const VW = innerWidth, VH = innerHeight, docH = document.documentElement.scrollHeight;
  const R = e => { const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + scrollY, w: b.width, h: b.height }; };
  const visible = e => { const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden' || +cs.opacity < 0.1) return false;
    const r = e.getBoundingClientRect(); return r.width > 4 && r.height > 4 && r.right > 0 && r.left < VW; };
  const parseRGB = s => { const m = (s || '').match(/rgba?\(([^)]+)\)/); if (!m) return null; const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] : 1 }; };
  const bgOf = e => { for (let x = e; x; x = x.parentElement) { const c = parseRGB(getComputedStyle(x).backgroundColor); if (c && c.a > 0.5) return c; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const cdist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
  const pageBg = (() => { const c = parseRGB(getComputedStyle(document.body).backgroundColor); if (c && c.a > 0.5) return c;
    const h = parseRGB(getComputedStyle(document.documentElement).backgroundColor); return h && h.a > 0.5 ? h : { r: 255, g: 255, b: 255, a: 1 }; })();

  const tops = [...document.querySelectorAll('section, main > *, body > *, [class*=hero], [id*=hero], header + *')].filter(visible)
    .map(e => R(e)).filter(r => r.w > VW * 0.9 && r.y <= 120 && r.y + r.h >= VH * 0.55 && r.y + r.h <= VH * 1.45);
  tops.sort((a, b) => Math.abs(a.y + a.h - VH) - Math.abs(b.y + b.h - VH));
  const hero = { x: 0, y: 0, w: VW, h: tops.length ? tops[0].y + tops[0].h : VH };
  const heads = [...document.querySelectorAll('h1,h2,h3')].filter(visible).map(e => ({ e, r: R(e) }));
  let introTitle = (heads.find(o => o.e.tagName === 'H2' && o.r.y >= hero.h - 40) || heads.find(o => o.r.y >= hero.h - 40) || { r: { x: 0, y: hero.h + 120, w: VW, h: 80 } }).r;
  const footEl = [...document.querySelectorAll('footer,[role=contentinfo]')].concat([...document.querySelectorAll('[class*=footer],[id*=footer]')])
    .filter(visible).map(e => ({ e, r: R(e) })).filter(o => o.r.w > VW * 0.6 && o.r.h > 100 && o.r.y > hero.h)[0];
  const footer = footEl ? footEl.r : { x: 0, y: Math.max(hero.h, docH - 500), w: VW, h: Math.min(500, docH - hero.h) };
  const L = S.landmarks || {};
  if (L.introTitle) introTitle = typeof L.introTitle === 'string' ? R(document.querySelector(L.introTitle)) : L.introTitle;

  const cands = [];
  const add = (e, role, score) => { const r = R(e); cands.push({ e, role, r, score }); };
  const area = r => r.w * r.h;

  for (const img of document.querySelectorAll('img, picture, video, canvas, svg image')) {
    if (!visible(img)) continue; const r0 = R(img); if (r0.w < 200 || r0.h < 140) continue;
    let e = img.closest('figure') || img.parentElement;

    while (e && e.parentElement && e !== document.body) {
      const a = R(e), pp = R(e.parentElement);
      if (Math.abs(pp.w - a.w) < 6 && Math.abs(pp.h - a.h) < 6 && e.parentElement.children.length === 1) e = e.parentElement; else break; }
    const r = R(e); if (Math.abs(r.w - r0.w) > 40 || Math.abs(r.h - r0.h) > 40) e = img.tagName === 'IMG' ? img : e;
    const rr = R(e); if (rr.w > VW * 0.62 || (rr.w > VW * 0.45 && rr.h > VH * 1.1)) continue;
    const txt = (e.innerText || '').replace(/\s+/g, ' ').trim();
    add(e, txt.length > 2 && e !== img ? 'card' : 'photo', area(rr));
  }
  for (const e of document.querySelectorAll('a, button')) {
    const img = e.querySelector('img'); if (!img || !visible(e)) continue; const r = R(e), ri = R(img);
    if (r.w >= 120 && r.h >= 90 && r.w < 480 && ri.w * ri.h > 0.5 * r.w * r.h) add(e, 'card', area(r));
  }

  for (const e of document.querySelectorAll('a, button, [role=button], input[type=submit]')) {
    if (!visible(e)) continue; const r = R(e); if (r.w < 60 || r.w > 420 || r.h < 28 || r.h > 110) continue;
    const cs = getComputedStyle(e), bg = parseRGB(cs.backgroundColor), txt = (e.innerText || e.value || '').trim();
    if (!txt || txt.length > 40 || !bg || bg.a < 0.6 || cdist(bg, bgOf(e.parentElement || e)) < 40) continue;
    if (e.closest('nav,header') && r.y < 140) continue;
    add(e, 'cta', 5000 + r.w * r.h);
  }

  for (const e of document.querySelectorAll('blockquote, [class*=testimonial] p, [class*=quote], [class*=review] p, q')) {
    if (!visible(e)) continue; const r = R(e); const txt = (e.innerText || '').trim();
    if (r.w < 220 || r.h < 60 || r.w > VW * 0.85 || txt.length < 40) continue;
    add(e.closest('figure') && R(e.closest('figure')).w < VW * 0.85 ? e.closest('figure') : e, 'testimonial', 1e6 + area(r));
  }
  for (const e of document.querySelectorAll('p, div')) {
    if (e.children.length > 3 || !visible(e)) continue; const t = (e.innerText || '').trim();
    if (/^[“"«„]/.test(t) && t.length > 50 && t.length < 500) { const r = R(e); if (r.w > 220 && r.w < VW * 0.85) add(e, 'testimonial', 1e6 + area(r)); }
  }

  for (const e of document.querySelectorAll('body *')) {
    if (!visible(e)) continue; const r = R(e); if (r.w < 160 || r.h < 120 || r.w > 720 || r.h > 820) continue;
    const cs = getComputedStyle(e), rad = parseFloat(cs.borderTopLeftRadius) || 0;
    const bg = parseRGB(cs.backgroundColor), own = bg && bg.a > 0.6 && cdist(bg, bgOf(e.parentElement || e)) > 12;
    const shadow = cs.boxShadow && cs.boxShadow !== 'none', border = parseFloat(cs.borderTopWidth) > 0 && rad >= 8;
    const hasImg = e.querySelector('img'); const imgFill = hasImg && R(hasImg).w * R(hasImg).h > r.w * r.h * 0.35;
    if ((rad >= 8 && (own || shadow || border)) || (rad >= 8 && imgFill) || (shadow && own)) add(e, 'card', area(r));
  }

  const forced = [];
  for (const d of S.pieces || []) {
    const els = [...document.querySelectorAll(d.sel)].filter(visible).sort((a, b) => R(a).x - R(b).x);
    let e = d.pick === 'leftmost' ? els[0] : d.pick === 'rightmost' ? els[els.length - 1] : [...document.querySelectorAll(d.sel)][d.idx || 0]; if (!e) continue;
    if (e.tagName === 'IMG') e = e.closest('figure') || e.parentElement;
    forced.push({ e, role: d.role || 'card', r: R(e), score: 1e9, id: d.id, fx: d.fx });
  }

  const PRI = { testimonial: 0, card: 1, photo: 2, cta: 3 };
  const pool = S.replacePieces ? [] : cands.sort((a, b) => PRI[a.role] - PRI[b.role] || b.score - a.score);
  const chosen = [];
  const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  const ok = c => {
    for (const o of chosen) {
      if (o.e === c.e || o.e.contains(c.e) || c.e.contains(o.e)) return false;
      if (inter(o.r, c.r) > 0.08 * Math.min(area(o.r), area(c.r))) return false; }

    if (c.role === 'card' && new Set(cands.filter(o => o.e !== c.e && c.e.contains(o.e) && o.role !== 'cta').map(o => o.e)).size >= 3) return false;
    return c.r.x >= -2 && c.r.x + c.r.w <= VW + 2 && c.r.y + c.r.h <= docH;
  };
  for (const c of forced) chosen.push(c);
  const MAX = S.maxPieces || 26;
  for (const c of pool) { if (chosen.length >= MAX) break; if (ok(c)) chosen.push(c); }

  chosen.sort((a, b) => a.r.y - b.r.y || a.r.x - b.r.x);
  const zone = r => (r.y + r.h / 2 < hero.h ? 'hero' : (r.y < introTitle.y + VH * 0.95 && r.y + r.h / 2 > introTitle.y - 80 ? 'intro' : 'body'));
  const n = {};
  const pieces = chosen.map(c => {
    const role = c.role; n[role] = (n[role] || 0) + 1;
    const id = c.id || `${role}${n[role]}`; c.e.setAttribute('data-layer', id);
    const p = { id, role, zone: zone(c.r), x: c.r.x, y: c.r.y, w: c.r.w, h: c.r.h };
    if (role === 'testimonial') p.boxed = !(parseRGB(getComputedStyle(c.e).backgroundColor)?.a > 0.6);
    if (c.fx) p.fx = c.fx; return p;
  });
  const heroCta = pieces.find(p => p.role === 'cta' && p.zone === 'hero');

  const sat = c => { const mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b); return mx ? (mx - mn) / mx : 0; };
  const tally = new Map();
  for (const e of document.querySelectorAll('a, button, [role=button]')) { if (!visible(e)) continue; const c = parseRGB(getComputedStyle(e).backgroundColor);
    if (!c || c.a < 0.6 || sat(c) < 0.25) continue; const k = `${c.r},${c.g},${c.b}`; const r = R(e); tally.set(k, (tally.get(k) || 0) + r.w * r.h); }
  let accent = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]?.split(',').map(Number) || null;
  if (!accent) { const tc = parseRGB((document.querySelector('meta[name=theme-color]')?.content || '').replace(/^#(..)(..)(..)$/, (m, a, b, c) => `rgb(${parseInt(a, 16)},${parseInt(b, 16)},${parseInt(c, 16)})`)); if (tc && sat(tc) > 0.2) accent = [tc.r, tc.g, tc.b]; }
  const heroCtaEl = document.querySelector(`[data-layer="${heroCta?.id}"]`);
  const ctaText = ((heroCtaEl || [...document.querySelectorAll('a,button')].find(e => visible(e) && R(e).y < hero.h && R(e).w > 80 && parseRGB(getComputedStyle(e).backgroundColor)?.a > 0.6))?.innerText || '').replace(/\s+/g, ' ').trim();
  return {
    bg: [pageBg.r, pageBg.g, pageBg.b], dark: (0.2126 * pageBg.r + 0.7152 * pageBg.g + 0.0722 * pageBg.b) / 255 < 0.4,
    title: document.title, H: docH,
    meta: { siteName: document.querySelector('meta[property="og:site_name"]')?.content || '', h1: (document.querySelector('h1')?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 80),
      description: document.querySelector('meta[name=description]')?.content || '',
      lang: (document.documentElement.lang || '').slice(0, 2).toLowerCase(), ctaText, accent,
      headings: heads.map(o => o.e.innerText.replace(/\s+/g, ' ').trim()).filter(t => t.length > 3 && t.length < 90).slice(0, 14),
      icons: [...document.querySelectorAll('link[rel*=icon], link[rel=apple-touch-icon]')].map(l => ({ href: l.href, sizes: l.getAttribute('sizes') || '', rel: l.rel }))
        .sort((a, b) => (parseInt(b.sizes) || (b.rel.includes('apple') ? 180 : 0)) - (parseInt(a.sizes) || (a.rel.includes('apple') ? 180 : 0))) }, hero, introTitle, footer, heroCta: heroCta ? { x: heroCta.x, y: heroCta.y, w: heroCta.w, h: heroCta.h } : null,
    pieces,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const a = process.argv.slice(2), url = a.find(x => !x.startsWith('--') && !a[a.indexOf(x) - 1]?.startsWith('--')) || 'https://example.com/';
  const opt = k => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : undefined; };
  await capture(url, { out: opt('out') || 'capture', site: opt('site') });
}
