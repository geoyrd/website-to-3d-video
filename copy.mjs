const TAIL_DEFAULT = { ro: 'Descoperă acum.', de: 'Jetzt entdecken.', en: 'See it for yourself.', es: 'Descúbrelo hoy.', fr: 'Découvrez-le.',
  it: 'Scoprilo ora.', pt: 'Descubra agora.', nl: 'Ontdek het nu.', pl: 'Sprawdź sam.', hu: 'Fedezd fel most.' };

const DANGLING = /^(für|und|oder|mit|von|zu|in|im|am|an|auf|der|die|das|de|și|si|sau|cu|la|în|pe|pentru|din|a|al|ale|and|or|for|with|of|to|in|on|the|a|an|y|o|con|para|del|la|el|los|las|et|ou|pour|avec|des|du|le|les|e|per|di|il)$/i;

const unspace = s => s.replace(/(?:^|\s)((?:\p{L} ){3,}\p{L})(?=\s|$)/gu, m => ' ' + m.replace(/ /g, '')).trim();
const uncaps = s => (s.length > 3 && s === s.toUpperCase() && s !== s.toLowerCase()) ? s[0] + s.slice(1).toLowerCase() : s;
const clean = s => uncaps(unspace((s || '').replace(/\s+/g, ' ').trim()));
const endDot = s => /[.!?…]$/.test(s) ? s : s + '.';
const sentence = s => s ? s[0].toUpperCase() + s.slice(1) : s;

const dedupe = s => { const w = s.split(' '); for (let n = 2; n < w.length - 1; n++) if (w[n] === w[0] && w[n + 1] === w[1]) return w.slice(0, n).join(' '); return s; };

function shorten(s, max) {
  s = clean(s); if (s.length <= max) return s;

  const m = s.match(/^(.{18,}?)\s*[–—:|•·]\s/) || s.match(/^(.{18,}?[.!?])\s/) || s.match(/^(.{22,}?),\s/);
  if (m && m[1].length <= max) return m[1].replace(/[.,;:]$/, '');
  const w = s.split(' '); const out = [];
  for (const x of w) { if ((out.join(' ') + ' ' + x).trim().length > max) break; out.push(x); }
  while (out.length > 2 && DANGLING.test(out[out.length - 1].replace(/[.,;:]$/, ''))) out.pop();
  return out.join(' ').replace(/[,;:–—-]$/, '');
}

export function heuristicCopy(scene) {
  const meta = scene.meta || {}, lang = meta.lang || 'en';
  let line1 = shorten(dedupe(clean(meta.h1)), 46);
  if (line1.length < 8 || !line1.includes(' ')) line1 = shorten(clean((scene.title || '').split(/\s[|–—·:]\s/)[0]), 46);
  line1 = endDot(sentence(line1));

  let tail = clean(meta.ctaText).replace(/[→›>»]+$/, '').trim();
  const ok = t => t && t.split(' ').length <= 4 && t.length <= 30 && !/^(kontakt|contact|login|log in|anmelden|menu|meniu)$/i.test(t);
  if (!ok(tail)) tail = (meta.headings || []).map(clean).find(h => h.split(' ').length >= 2 && h.split(' ').length <= 4 && h.length <= 30 && h.toLowerCase() !== line1.toLowerCase().replace(/\.$/, '')) || '';
  if (!ok(tail)) tail = TAIL_DEFAULT[lang] || TAIL_DEFAULT.en;
  tail = endDot(sentence(tail));
  return { line1, tail, source: 'heuristic' };
}

async function claudeCopy(scene, brand) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { z } = await import('zod'); const { zodOutputFormat } = await import('@anthropic-ai/sdk/helpers/zod');
  const meta = scene.meta || {};
  const Copy = z.object({ line1: z.string(), tail: z.string() });
  const client = new Anthropic({ timeout: 45_000, maxRetries: 1 });
  const page = { brand, url: scene.url, language: meta.lang || 'unknown', title: scene.title, h1: meta.h1, description: meta.description,
    heroButton: meta.ctaText, headings: meta.headings };
  const res = await client.messages.parse({
    model: 'claude-opus-5-5', max_tokens: 2000,
    output_config: { effort: 'low', format: zodOutputFormat(Copy) },
    messages: [{ role: 'user', content:
      `Write the closing title card for a 15-second product video that flies over this company's landing page.\n` +
      `line1: one clear statement of what the company offers, max 45 characters, ending with a period.\n` +
      `tail: a short, warm second line shown in italics, 2-4 words, ending with a period.\n` +
      `Write both in the page's own language and match its tone. Plain text, no quotes, no emoji, no brand name.\n\n` +
      `Page: ${JSON.stringify(page)}` }],
  });
  const out = res.parsed_output;
  if (!out || !out.line1 || !out.tail) throw new Error(`no copy (stop_reason ${res.stop_reason})`);
  return { line1: clean(out.line1), tail: clean(out.tail), source: 'claude' };
}

export async function endCopy(scene, { brand = '', log = () => {} } = {}) {
  if (process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN) {
    try { return await claudeCopy(scene, brand); } catch (e) { log(`copy: Claude unavailable (${e.message.slice(0, 80)}), using page text`); }
  }
  return heuristicCopy(scene);
}
