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
  if (a.domain && (!Array.isArray(a.domain) || a.domain.length === 0)) errors.push(`${f}: domain needs at least one entry`);
  if (a.id) { if (ids.has(a.id)) errors.push(`${f}: duplicate id ${a.id} (also ${ids.get(a.id)})`); ids.set(a.id, f); }
  if (a.id && path.basename(f) !== `${a.id}.json`) errors.push(`${f}: file name should be ${a.id}.json`);
}
for (const [f, a] of atoms) for (const l of a.links || []) if (!ids.has(l)) errors.push(`${f}: link to unknown atom ${l}`);

if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
console.log(`ok: ${atoms.length} atoms`);
