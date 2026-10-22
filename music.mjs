import fs from 'fs'; import path from 'path';
const ROOT = path.dirname(new URL(import.meta.url).pathname);
export const library = () => JSON.parse(fs.readFileSync(path.join(ROOT, 'music/library.json'), 'utf8')).tracks;
export function resolveMusic(choice) {
  if (!choice) return null;
  const t = library().find(x => x.id === choice || x.name.toLowerCase() === String(choice).toLowerCase());
  if (t) return path.join('music', t.file);
  return fs.existsSync(choice) ? choice : null;
}
