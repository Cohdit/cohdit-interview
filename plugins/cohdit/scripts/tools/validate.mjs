// Validate every knowledge atom against schema/atom.schema.json (no dependencies).
// Usage: node scripts/validate.mjs <expert-repo-folder>
import fs from 'node:fs';
import path from 'node:path';
import { atomFiles } from './lib.mjs';

const root = path.resolve(process.argv[2] || '.');
const schema = JSON.parse(fs.readFileSync(new URL('../schema/atom.schema.json', import.meta.url), 'utf8'));
const files = atomFiles(root);

const errors = [];
const ids = new Map();
const atoms = [];
for (const f of files) {
  let a;
  try { a = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { errors.push(`${f}: not valid JSON`); continue; }
  atoms.push([f, a]);
  for (const k of schema.required) if (!(k in a)) errors.push(`${f}: missing "${k}"`);
  for (const k of Object.keys(a)) if (!(k in schema.properties)) errors.push(`${f}: unknown field "${k}"`);
  const p = schema.properties;
  if (a.id && !new RegExp(p.id.pattern).test(a.id)) errors.push(`${f}: bad id "${a.id}"`);
  if (a.type && !p.type.enum.includes(a.type)) errors.push(`${f}: bad type "${a.type}"`);
  if (a.status && !p.status.enum.includes(a.status)) errors.push(`${f}: bad status "${a.status}"`);
  if (a.statement && a.statement.length > p.statement.maxLength) errors.push(`${f}: statement over ${p.statement.maxLength} characters`);
  if ('firm' in a && typeof a.firm !== 'boolean') errors.push(`${f}: firm must be true or false`);
  for (const k of ['corrects', 'when', 'place']) {
    if (k in a && typeof a[k] !== 'string') errors.push(`${f}: ${k} must be text`);
    else if (a[k] && a[k].length > p[k].maxLength) errors.push(`${f}: ${k} over ${p[k].maxLength} characters`);
  }
  if ('evidence' in a) {
    const e = a.evidence, ep = p.evidence.properties;
    if (!e || typeof e !== 'object' || Array.isArray(e)) errors.push(`${f}: evidence must be an object`);
    else {
      for (const k of Object.keys(e)) if (!(k in ep)) errors.push(`${f}: unknown evidence field "${k}"`);
      if (e.edge && !ep.edge.enum.includes(e.edge)) errors.push(`${f}: evidence.edge must be one of ${ep.edge.enum.join(', ')}`);
      for (const k of ['won', 'lost']) if (k in e && !Array.isArray(e[k])) errors.push(`${f}: evidence.${k} must be a list`);
    }
  }
  if (a.domain && (!Array.isArray(a.domain) || a.domain.length === 0)) errors.push(`${f}: domain needs at least one entry`);
  if (a.id) { if (ids.has(a.id)) errors.push(`${f}: duplicate id ${a.id} (also ${ids.get(a.id)})`); ids.set(a.id, f); }
  if (a.id && path.basename(f) !== `${a.id}.json`) errors.push(`${f}: file name should be ${a.id}.json`);
}
// expert.json may record how deep the expert is in each topic.
const DEPTHS = ['deep', 'working', 'light'];
const ej = path.join(root, 'expert.json');
const expert = fs.existsSync(ej) ? JSON.parse(fs.readFileSync(ej, 'utf8')) : {};
for (const [d, v] of Object.entries(expert.depth || {})) if (!DEPTHS.includes(v)) errors.push(`expert.json: depth for "${d}" must be one of ${DEPTHS.join(', ')}`);
for (const [f, a] of atoms) for (const l of a.links || []) if (!ids.has(l)) errors.push(`${f}: link to unknown atom ${l}`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`ok: ${atoms.length} atoms`);
