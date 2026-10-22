import fs from 'fs'; import path from 'path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const lib = JSON.parse(fs.readFileSync(path.join(root, 'music/library.json'), 'utf8')).tracks;
for (const t of lib) {
  const out = path.join(root, 'music', t.file);
  if (fs.existsSync(out) && fs.statSync(out).size > 100000) { console.log('ok      ', t.name); continue; }
  try {
    const r = await fetch(t.download, { headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://pixabay.com/' } });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    fs.writeFileSync(out, Buffer.from(await r.arrayBuffer()));
    console.log('download', t.name, `(${(fs.statSync(out).size / 1048576).toFixed(1)} MB)`);
  } catch (e) { console.log('skipped ', t.name, '-', e.message, '- get it manually from', t.source); }
}
