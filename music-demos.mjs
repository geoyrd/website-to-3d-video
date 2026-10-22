import { buildSound } from './sound.mjs'; import { spawnSync } from 'child_process'; import fs from 'fs'; import path from 'path';
const [scene, video, cfgJson, ...tracks] = process.argv.slice(2);
const cfg = JSON.parse(cfgJson); fs.mkdirSync('out/music-demos', { recursive: true });
for (const t of tracks) {
  const base = path.basename(t, path.extname(t)), wav = `out/music-demos/${base}.wav`, mp4 = `out/music-demos/${base}.mp4`;
  await buildSound({ scene, cfg, out: wav, track: t });
  const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', mp4]);
  if (r.status) console.log(String(r.stderr)); else console.log('  ->', mp4);
}
