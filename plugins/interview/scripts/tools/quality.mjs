// Score an expert's knowledge against the benchmarks. Prints what is met, what is missing and a readiness
// level. Usage: node scripts/quality.mjs <expert-repo-folder>   (exit 1 unless readiness is "high")
import fs from 'node:fs';
import path from 'node:path';
import { readAtoms } from './lib.mjs';

const dir = process.argv[2];
const def = JSON.parse(fs.readFileSync(new URL('../schema/benchmarks.default.json', import.meta.url), 'utf8'));
const own = fs.existsSync(path.join(dir, 'benchmarks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'benchmarks.json'), 'utf8')) : {};
const raise = (d, o) => { const r = { ...d }; for (const k of Object.keys(o || {})) r[k] = typeof d[k] === 'object' && d[k] !== null ? raise(d[k], o[k]) : (typeof d[k] === 'number' && o[k] < d[k] ? d[k] : o[k]); return r; };
const B = raise(def, own);

const atoms = readAtoms(dir).map((x) => x.atom).filter((a) => a.status === 'confirmed');
const lines = (f) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length : 0;
const golden = fs.existsSync(path.join(dir, 'calibration.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'calibration.json'), 'utf8')) : { questions: [], ratings: [] };

// Score the expert's declared core domains; a stray tag is not a domain the agent must master.
const domains = own.core_domains && own.core_domains.length ? own.core_domains : [...new Set(atoms.flatMap((a) => a.domain))].sort();
const gaps = [];
const rows = [];
for (const d of domains) {
  const as = atoms.filter((a) => a.domain.includes(d));
  const why = as.filter((a) => a.why).length / as.length;
  const unl = as.filter((a) => a.unless).length / as.length;
  const st = as.filter((a) => a.type === 'story' || a.example).length;
  const p = B.per_domain;
  const miss = [];
  if (as.length < p.min_confirmed_atoms) miss.push(`atoms ${as.length}/${p.min_confirmed_atoms}`);
  if (why < p.min_with_why) miss.push(`why ${Math.round(why * 100)}%/${p.min_with_why * 100}%`);
  if (unl < p.min_with_unless) miss.push(`unless ${Math.round(unl * 100)}%/${p.min_with_unless * 100}%`);
  if (st < p.min_stories) miss.push(`stories ${st}/${p.min_stories}`);
  rows.push([d, as.length, miss]);
  if (miss.length) gaps.push(`domain ${d}: ${miss.join(', ')}`);
}
const v = lines('voice.md'), bd = lines('boundaries.md'), dc = lines('decisions.md');
if (v < B.voice.min_samples) gaps.push(`voice samples ${v}/${B.voice.min_samples}`);
if (bd < B.boundaries.min_items) gaps.push(`boundaries ${bd}/${B.boundaries.min_items}`);
if (dc < B.decision_calls.min_items) gaps.push(`decision calls ${dc}/${B.decision_calls.min_items}`);
const qs = golden.questions.length;
if (qs < B.calibration.min_questions) gaps.push(`calibration questions ${qs}/${B.calibration.min_questions}`);
const qd = new Set(golden.questions.map((q) => q.domain));
const unc = domains.filter((d) => !qd.has(d));
if (B.calibration.min_domains_covered === 'all' && unc.length) gaps.push(`calibration misses domains: ${unc.join(', ')}`);
const r = golden.ratings.map((x) => x.score);
const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
if (!r.length) gaps.push('no blind rating yet (the expert has not scored the agent against their own answers)');
else {
  if (mean < B.calibration.blind_rating_mean) gaps.push(`blind rating mean ${mean.toFixed(2)}/${B.calibration.blind_rating_mean}`);
  if (Math.min(...r) < B.calibration.blind_rating_floor) gaps.push(`a blind rating below ${B.calibration.blind_rating_floor}`);
}
const open = (golden.contradictions || []).filter((c) => !c.resolved).length;
if (open > B.calibration.max_unresolved_contradictions) gaps.push(`unresolved contradictions ${open}`);

console.log(`Expert: ${dir}  confirmed atoms: ${atoms.length}`);
for (const [d, n, m] of rows) console.log(`  ${m.length ? 'GAP' : 'ok '} ${d.padEnd(14)} ${String(n).padStart(3)} atoms${m.length ? '  ' + m.join(', ') : ''}`);
console.log(`  voice ${v}  boundaries ${bd}  decision calls ${dc}  calibration questions ${qs}`);
const structural = gaps.filter((g) => !/blind|rating|contradiction/.test(g));
const level = gaps.length === 0 ? 'high' : structural.length <= 3 ? 'medium' : 'low';
console.log(`Readiness: ${level}${gaps.length ? '  (' + gaps.length + ' gaps)' : ''}`);
process.exit(gaps.length === 0 ? 0 : 1);
