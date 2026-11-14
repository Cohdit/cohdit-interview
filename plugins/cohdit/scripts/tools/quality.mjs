// Score an expert's knowledge against the benchmarks. Prints what is met, what is missing and a readiness
// level. Usage: node scripts/quality.mjs <expert-repo-folder>   (exit 1 unless readiness is "high")
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readAtoms, readLog, timeSpent } from './lib.mjs';

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
// How deep the expert is in each topic (expert.json). A light topic has a lower bar; an unasked one is a gap.
const expert = fs.existsSync(path.join(dir, 'expert.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'expert.json'), 'utf8')) : {};
const depth = expert.depth || {};
const bar = (d) => (depth[d] === 'light' ? B.light_domain : B.per_domain);
const gaps = [];
const rows = [];
const unasked = domains.filter((d) => !depth[d]);
if (unasked.length) gaps.push(`depth not asked: ${unasked.join(', ')}`);
for (const d of domains) {
  const as = atoms.filter((a) => a.domain.includes(d));
  const why = as.filter((a) => a.why).length;
  const unl = as.filter((a) => a.unless).length;
  const st = as.filter((a) => a.type === 'story' || a.example).length;
  const p = bar(d);
  const miss = [];
  if (as.length < p.min_confirmed_atoms) miss.push(`atoms ${as.length}/${p.min_confirmed_atoms}`);
  // Fixed counts (a share of the minimum), the same checklist as Progress below, so 100% means no topic gaps.
  const needWhy = Math.ceil(p.min_confirmed_atoms * p.min_with_why), needUnl = Math.ceil(p.min_confirmed_atoms * p.min_with_unless);
  if (why < needWhy) miss.push(`why ${why}/${needWhy}`);
  if (unl < needUnl) miss.push(`unless ${unl}/${needUnl}`);
  if (st < p.min_stories) miss.push(`stories ${st}/${p.min_stories}`);
  rows.push([d, as.length, miss, depth[d] || '?']);
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

// Progress toward the bar, for the expert, as a fixed checklist: each topic needs a set number of points, of
// reasons, of exceptions and of stories, so an answer can only shorten the list (the readiness bar above is the
// stricter, ratio-based one). Drafts count, since they only wait for the expert's review.
let have = 0, need = 0;
const unit = (got, target) => { need += target; have += Math.min(got, target); };
const all = readAtoms(dir).map((x) => x.atom).filter((a) => a.status === 'confirmed' || a.status === 'draft');
for (const d of domains) {
  const as = all.filter((a) => a.domain.includes(d));
  const p = bar(d);
  unit(as.length, p.min_confirmed_atoms);
  unit(as.filter((a) => a.why).length, Math.ceil(p.min_confirmed_atoms * p.min_with_why));
  unit(as.filter((a) => a.unless).length, Math.ceil(p.min_confirmed_atoms * p.min_with_unless));
  unit(as.filter((a) => a.type === 'story' || a.example).length, p.min_stories);
}
unit(domains.length - unasked.length, domains.length);
unit(v, B.voice.min_samples);
unit(bd, B.boundaries.min_items);
unit(dc, B.decision_calls.min_items);
unit(qs, B.calibration.min_questions);
// Progress for the expert: accurate first, steady second.
// - Time left comes from the expert's measured rate: checklist items gained per hour of logged interviewing,
//   counted from a baseline taken when the log starts (rebuilt from git when the log was backfilled), so
//   knowledge imported before the interviews never makes the pace look faster than it is.
// - Until there is enough to measure (10 items and 45 minutes), a deliberately slow default is used and the line
//   says it is a first guess: better to finish early than to run over.
// - The numbers are never hidden or held back. If answers left goes up, the line says why.
const spent = timeSpent(readLog(dir));
const RAW = process.argv.includes('--raw');
const markFile = path.join(dir, 'progress.json');
let mark = {};
try { mark = JSON.parse(fs.readFileSync(markFile, 'utf8')); } catch {}
if (!mark.baseline && !RAW) mark.baseline = baselineFor(spent);
// Points along the way (one per 10 minutes of logged time), so the pace can be read over the most recent
// 4 hours of interviewing: it follows the interview as it is now, not how it went at the start.
const history = (mark.history || []).filter((h) => h.ms <= spent.ms);
if (!RAW && spent.ms && (!history.length || spent.ms - history.at(-1).ms >= 10 * 60000)) history.push({ ms: spent.ms, answers: spent.answers, have });
const start = mark.baseline || { ms: spent.ms, answers: spent.answers, have };
const rate = (from) => ({ items: have - from.have, ms: spent.ms - from.ms, answers: spent.answers - from.answers });
const enough = (x) => x.items >= 10 && x.ms >= 45 * 60000;
const recentFrom = [start, ...history].filter((h) => h.ms >= spent.ms - 4 * 3600000).sort((a, b) => a.ms - b.ms)[0];
const pick = [recentFrom && rate(recentFrom), rate(start)].find((x) => x && enough(x));
const measured = Boolean(pick);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
// The default, before anything is measured, is the slow side of what interviews have shown: 15 minutes and three
// answers for each checklist item.
const minutesPerItem = measured ? clamp(pick.ms / 60000 / pick.items, 1, 60) : 15;
const answersPerItem = measured ? clamp(pick.answers / pick.items, 0.5, 6) : 3;
const itemsLeft = need - have;
const round5 = (n) => (n > 30 ? Math.round(n / 5) * 5 : n);
const left = itemsLeft ? round5(Math.ceil(itemsLeft * answersPerItem)) : 0;
const scoring = r.length ? 0 : 30;
const etaMin = Math.round(itemsLeft * minutesPerItem) + scoring;
const pct = need ? Math.floor((100 * have) / need) : 100;
let why = '';
const shown = mark.shown;
if (shown && left > shown.left) {
  why = need > shown.need ? 'the list grew (a new topic, or a topic marked deeper)'
    : have < shown.have ? 'some points were dropped or retired'
    : 'your pace so far is slower than the estimate assumed';
  why = ` Up from ${shown.left}: ${why}.`;
}
if (!RAW) {
  const next = { baseline: mark.baseline, history: history.slice(-200), shown: { left, need, have, eta_minutes: etaMin } };
  if (JSON.stringify(next) !== JSON.stringify(mark)) { try { fs.writeFileSync(markFile, JSON.stringify(next, null, 2) + '\n'); } catch {} }
}
const hrs = (m) => `${Math.round(m / 6) / 10} hours`;
const duration = (m) => m < 60 ? `${Math.ceil(m / 5) * 5} minutes` : `${Math.ceil(m / 30) / 2} hours`;
const so_far = spent.ms ? `, ${hrs(spent.ms / 60000)} in over ${spent.sessions} session${spent.sessions === 1 ? '' : 's'}` : '';
const guess = measured ? '' : ' (a first guess until your pace is measured)';
const after = scoring ? ', plus about 30 minutes at the end scoring the agent' : '';
const progress = itemsLeft
  ? `Progress: ${pct}% of the way${so_far}. About ${left} more answers, roughly ${duration(etaMin - scoring)}${guess}${after}.${why}`
  : `Progress: all answers in${so_far}${scoring ? '; last, about 30 minutes scoring the agent' : ''}.`;

/** Checklist items done when the log began: from git when the log starts in the past (a backfill), else now. */
function baselineFor(spent) {
  const events = readLog(dir);
  const first = events.length ? Math.min(...events.map((e) => e.t)) : null;
  if (first && Date.now() - first > 3600000) {
    try {
      const git = (...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const rev = git('rev-list', '-1', `--before=${Math.floor(first / 1000)}`, 'HEAD');
      if (rev) {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-then-'));
        execFileSync('sh', ['-c', `git -C "${dir}" archive ${rev} | tar -x -C "${tmp}"`], { stdio: 'ignore' });
        const then = JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), tmp, '--json', '--raw'], { encoding: 'utf8' }));
        fs.rmSync(tmp, { recursive: true, force: true });
        return { from: 'git', t: first, ms: 0, answers: 0, have: then.units.have };
      }
    } catch {}
  }
  return { from: 'now', t: Date.now(), ms: spent.ms, answers: spent.answers, have };
}
if (process.argv.includes('--json')) {
  const every = readAtoms(dir).map((x) => x.atom);
  const by = (st) => every.filter((a) => a.status === st).length;
  console.log(JSON.stringify({
    atoms: { draft: by('draft'), confirmed: by('confirmed'), retired: by('retired') },
    topics: Object.fromEntries(domains.map((d) => [d, all.filter((a) => a.domain.includes(d)).length])),
    depth, progress: pct, left, eta: etaMin, units: { have, need }, measured, hours: Math.round(spent.ms / 360000) / 10, sessions: spent.sessions, line: progress,
  }));
  process.exit(0);
}
console.log(`Expert: ${dir}  confirmed atoms: ${atoms.length}`);
for (const [d, n, m, dp] of rows) console.log(`  ${m.length ? 'GAP' : 'ok '} ${d.padEnd(14)} ${dp.padEnd(7)} ${String(n).padStart(3)} atoms${m.length ? '  ' + m.join(', ') : ''}`);
console.log(`  voice ${v}  boundaries ${bd}  decision calls ${dc}  calibration questions ${qs}`);
console.log(progress);
const structural = gaps.filter((g) => !/blind|rating|contradiction/.test(g));
const level = gaps.length === 0 ? 'high' : structural.length <= 3 ? 'medium' : 'low';
console.log(`Readiness: ${level}${gaps.length ? '  (' + gaps.length + ' gaps)' : ''}`);
process.exit(gaps.length === 0 ? 0 : 1);
