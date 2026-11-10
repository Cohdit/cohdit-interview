// Shared helpers. An expert's repo is the folder passed to each script: profile.md, benchmarks.json,
// atoms/<domain>/A-NNN.json, voice.md, boundaries.md, decisions.md, calibration.json, sources/, build/.
import fs from 'node:fs';
import path from 'node:path';

export function atomFiles(dir) {
  const out = [];
  const root = path.join(dir, 'atoms');
  if (!fs.existsSync(root)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.json')) out.push(p);
    }
  })(root);
  return out.sort();
}

export function readAtoms(dir) {
  return atomFiles(dir).map((f) => ({ file: f, atom: JSON.parse(fs.readFileSync(f, 'utf8')) }));
}
