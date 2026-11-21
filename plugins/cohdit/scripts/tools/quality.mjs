// Score an expert's knowledge against the benchmarks. Prints what is met, what is missing and a readiness
// level. Usage: node scripts/quality.mjs <expert-repo-folder>   (exit 1 unless readiness is "high")
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readAtoms, readLog, timeSpent, readDumps, fromDump } from './lib.mjs';
import { score as duelScore, load } from './duel.mjs';

const dir = process.argv[2];
const def = JSON.parse(fs.readFileSync(new URL('../schema/benchmarks.default.json', import.meta.url), 'utf8'));
const own = fs.existsSync(path.join(dir, 'benchmarks.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'benchmarks.json'), 'utf8')) : {};
const raise = (d, o) => { const r = { ...d }; for (const k of Object.keys(o || {})) r[k] = typeof d[k] === 'object' && d[k] !== null ? raise(d[k], o[k]) : (typeof d[k] === 'number' && o[k] < d[k] ? d[k] : o[k]); return r; };
const B = raise(def, own);

const atoms = readAtoms(dir).map((x) => x.atom).filter((a) => a.status === 'confirmed');
// A point the edge audit found plain Claude already gives adds nothing the agent needs from this expert, so it
// does not count toward a topic. It stays in the repo and the agent; it just does not fill the checklist.
const counts = (a) => !(a.evidence && a.evidence.edge === 'generic');
const lines = (f) => fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter((l) => /^\s*[-*]\s+\S/.test(l)).length : 0;
const golden = fs.existsSync(path.join(dir, 'calibration.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'calibration.json'), 'utf8')) : { questions: [], ratings: [] };

// Score the expert's declared core domains; a stray tag is not a domain the agent must master.
const domains = own.core_domains && own.core_domains.length ? own.core_domains : [...new Set(atoms.flatMap((a) => a.domain))].sort();
// How deep the expert is in each topic (expert.json). A light topic has a lower bar; an unasked one is a gap.
const expert = fs.existsSync(path.join(dir, 'expert.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'expert.json'), 'utf8')) : {};
const depth = expert.depth || {};
// A topic where plain Claude was already right in the last few sparring scenarios needs nothing from the
// expert: common practice covers it, so it is settled and leaves the checklist. One correction reopens it.
const SETTLE = B.sparring.settled_after;
const sparred = load(dir).scenarios.filter((s) => s.kind === 'spar' && typeof s.agree === 'boolean')
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));
const settled = new Set(domains.filter((d) => {
  const last = sparred.filter((s) => s.domain === d).slice(-SETTLE);
  return last.length === SETTLE && last.every((s) => s.agree);
}));
const NONE = { min_confirmed_atoms: 0, min_with_why: 0, min_with_unless: 0, min_stories: 0 };
const bar = (d) => (settled.has(d) ? NONE : depth[d] === 'light' ? B.light_domain : B.per_domain);
const gaps = [];
const rows = [];
const unasked = domains.filter((d) => !depth[d] && !settled.has(d));
if (unasked.length) gaps.push(`depth not asked: ${unasked.join(', ')}`);
for (const d of domains) {
  const as = atoms.filter((a) => a.domain.includes(d) && counts(a));
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
  rows.push([d, as.length, miss, settled.has(d) ? 'common' : depth[d] || '?']);
  if (miss.length) gaps.push(`domain ${d}: ${miss.join(', ')}`);
}
const v = lines('voice.md'), bd = lines('boundaries.md'), dc = lines('decisions.md');
if (v < B.voice.min_samples) gaps.push(`voice samples ${v}/${B.voice.min_samples}`);
if (bd < B.boundaries.min_items) gaps.push(`boundaries ${bd}/${B.boundaries.min_items}`);
if (dc < B.decision_calls.min_items) gaps.push(`decision calls ${dc}/${B.decision_calls.min_items}`);
const qs = golden.questions.length;
const r = golden.ratings.map((x) => x.score);
const mean = r.length ? r.reduce((a, b) => a + b, 0) / r.length : 0;
// Scoring answers the expert can see flatters the agent, so it is only a requirement where an expert's own
// benchmarks ask for it. The bar is the blind head-to-head below.
if (B.calibration.required) {
  if (qs < B.calibration.min_questions) gaps.push(`calibration questions ${qs}/${B.calibration.min_questions}`);
  const qd = new Set(golden.questions.map((q) => q.domain));
  const unc = domains.filter((d) => !qd.has(d));
  if (B.calibration.min_domains_covered === 'all' && unc.length) gaps.push(`calibration misses domains: ${unc.join(', ')}`);
  if (!r.length) gaps.push('no calibration rating yet');
  else {
    if (mean < B.calibration.blind_rating_mean) gaps.push(`calibration rating mean ${mean.toFixed(2)}/${B.calibration.blind_rating_mean}`);
    if (Math.min(...r) < B.calibration.blind_rating_floor) gaps.push(`a calibration rating below ${B.calibration.blind_rating_floor}`);
  }
}
// The readiness bar: does the agent beat plain Claude on what a real client would ask, as the expert judges blind.
const H = B.head_to_head;
const duel = duelScore(dir, H.min_picks);
if (duel.window < H.min_picks) gaps.push(`head-to-head picks ${duel.window}/${H.min_picks}`);
else if (duel.win_rate < H.min_win_rate) gaps.push(`head-to-head win rate ${Math.round(100 * duel.win_rate)}%/${Math.round(100 * H.min_win_rate)}%`);
// Positioning: who the agent is for, and why this expert rather than another in the same trade.
const niche = expert.niche || {};
const nicheMissing = B.niche.required.filter((k) => !String(niche[k] || '').trim());
if (nicheMissing.length) gaps.push(`niche not set: ${nicheMissing.join(', ')}`);
const open = (golden.contradictions || []).filter((c) => !c.resolved).length;
if (open > B.calibration.max_unresolved_contradictions) gaps.push(`unresolved contradictions ${open}`);

// Progress toward the bar, for the expert, as a fixed checklist: each topic needs a set number of points, of
// reasons, of exceptions and of stories, so an answer can only shorten the list (the readiness bar above is the
// stricter, ratio-based one). Drafts count, since they only wait for the expert's review.
let have = 0, need = 0;
const rem = {};
const unit = (got, target, what = 'topic') => { need += target; have += Math.min(got, target); rem[what] = (rem[what] || 0) + target - Math.min(got, target); };
const all = readAtoms(dir).map((x) => x.atom).filter((a) => a.status === 'confirmed' || a.status === 'draft');
const edgeOf = (k) => all.filter((a) => a.evidence && a.evidence.edge === k).length;
const edge = { edge: edgeOf('edge'), partial: edgeOf('partial'), generic: edgeOf('generic') };
edge.audited = edge.edge + edge.partial + edge.generic;
edge.unchecked = all.length - edge.audited;
// Checklist items the topics' atoms fill, for a given set of atoms (the whole set, or the set without dumps).
const topicUnits = (list) => domains.reduce((n, d) => {
  const as = list.filter((a) => a.domain.includes(d) && counts(a));
  const p = bar(d);
  return n + Math.min(as.length, p.min_confirmed_atoms)
    + Math.min(as.filter((a) => a.why).length, Math.ceil(p.min_confirmed_atoms * p.min_with_why))
    + Math.min(as.filter((a) => a.unless).length, Math.ceil(p.min_confirmed_atoms * p.min_with_unless))
    + Math.min(as.filter((a) => a.type === 'story' || a.example).length, p.min_stories);
}, 0);
for (const d of domains) {
  const as = all.filter((a) => a.domain.includes(d) && counts(a));
  const p = bar(d);
  unit(as.length, p.min_confirmed_atoms);
  unit(as.filter((a) => a.why).length, Math.ceil(p.min_confirmed_atoms * p.min_with_why));
  unit(as.filter((a) => a.unless).length, Math.ceil(p.min_confirmed_atoms * p.min_with_unless));
  unit(as.filter((a) => a.type === 'story' || a.example).length, p.min_stories);
}
// What the dumps alone added to the checklist (topic points, reasons, exceptions, stories; voice and the like
// are not attributed), so a dump-first approach can be compared with interviewing.
const dumps = readDumps(dir);
const dumpAtoms = all.filter(fromDump).length;
const dumpItems = topicUnits(all) - topicUnits(all.filter((a) => !fromDump(a)));
unit(domains.length - unasked.length, domains.length, 'topic');
unit(v, B.voice.min_samples, 'voice');
unit(bd, B.boundaries.min_items, 'boundaries');
unit(dc, B.decision_calls.min_items, 'decisions');
unit(B.niche.required.length - nicheMissing.length, B.niche.required.length, 'niche');
if (B.calibration.required) unit(qs, B.calibration.min_questions, 'questions');
// Head-to-head picks take a few seconds each, so they are timed apart from the interview pace below.
const picksLeft = Math.max(0, H.min_picks - duel.window);
unit(duel.window, H.min_picks, 'picks');
// The pace below counts interview items only, so quick picks never make the interview look faster than it is.
const paceHave = have - Math.min(duel.window, H.min_picks);
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
if (!RAW && spent.ms && (!history.length || spent.ms - history.at(-1).ms >= 10 * 60000)) history.push({ ms: spent.ms, answers: spent.answers, have: paceHave });
const start = mark.baseline || { ms: spent.ms, answers: spent.answers, have: paceHave };
const rate = (from) => ({ items: paceHave - from.have, ms: spent.ms - from.ms, answers: spent.answers - from.answers });
const enough = (x) => x.items >= 10 && x.ms >= 45 * 60000;
const recentFrom = [start, ...history].filter((h) => h.ms >= spent.ms - 4 * 3600000).sort((a, b) => a.ms - b.ms)[0];
const pick = [recentFrom && rate(recentFrom), rate(start)].find((x) => x && enough(x));
const measured = Boolean(pick);
const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
// The default, before anything is measured, is the slow side of what interviews have shown: 15 minutes and three
// answers for each checklist item.
const minutesPerItem = measured ? clamp(pick.ms / 60000 / pick.items, 1, 60) : 15;
const answersPerItem = measured ? clamp(pick.answers / pick.items, 0.5, 6) : 3;
const itemsLeft = (need - have) - picksLeft;
const round5 = (n) => (n > 30 ? Math.round(n / 5) * 5 : n);
const left = itemsLeft ? round5(Math.ceil(itemsLeft * answersPerItem)) : 0;
const scoring = picksLeft ? Math.max(5, Math.ceil(picksLeft * 0.5 / 5) * 5) : 0;
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
// What is left, in plain terms, so the end is visible: topic points are knowledge; the rest are quick to do in bulk.
const WORDS = { topic: ['topic point', 'topic points'], voice: ['voice sample', 'voice samples'], boundaries: ['boundary', 'boundaries'], decisions: ['decision call', 'decision calls'], questions: ['test question to score', 'test questions to score'], picks: ['check on your agent', 'checks on your agent'], niche: ['niche answer', 'niche answers'] };
const leftLine = Object.entries(rem).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${n} ${WORDS[k][n === 1 ? 0 : 1]}`).join(', ');
const hrs = (m) => `${Math.round(m / 6) / 10} hours`;
const duration = (m) => m < 60 ? `${Math.ceil(m / 5) * 5} minutes` : `${Math.ceil(m / 30) / 2} hours`;
const so_far = spent.ms ? `, ${hrs(spent.ms / 60000)} in over ${spent.sessions} session${spent.sessions === 1 ? '' : 's'}` : '';
const guess = measured ? '' : ' (a first guess until your pace is measured)';
const after = scoring ? `, plus about ${scoring} minutes of quick checks on your agent` : '';
const progress = itemsLeft
  ? `Progress: ${pct}% of the way${so_far}. About ${left} more answers, roughly ${duration(etaMin - scoring)}${guess}${after}.${why}`
  : `Progress: all answers in${so_far}${scoring ? `; last, about ${scoring} minutes of quick checks on your agent` : ''}.`;

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
        return { from: 'git', t: first, ms: 0, answers: 0, have: then.units.pace ?? then.units.have };
      }
    } catch {}
  }
  return { from: 'now', t: Date.now(), ms: spent.ms, answers: spent.answers, have: paceHave };
}
if (process.argv.includes('--json')) {
  const every = readAtoms(dir).map((x) => x.atom);
  const by = (st) => every.filter((a) => a.status === st).length;
  console.log(JSON.stringify({
    atoms: { draft: by('draft'), confirmed: by('confirmed'), retired: by('retired') },
    topics: Object.fromEntries(domains.map((d) => [d, all.filter((a) => a.domain.includes(d)).length])),
    depth, settled: [...settled], edge, remaining: rem, head_to_head: duel, niche, dumps: { files: dumps.files, words: dumps.words, atoms: dumpAtoms, items: dumpItems }, progress: pct, left, eta: etaMin, units: { have, need, pace: paceHave }, measured, hours: Math.round(spent.ms / 360000) / 10, sessions: spent.sessions, line: progress,
  }));
  process.exit(0);
}
console.log(`Expert: ${dir}  confirmed atoms: ${atoms.length}`);
for (const [d, n, m, dp] of rows) console.log(`  ${m.length ? 'GAP' : 'ok '} ${d.padEnd(14)} ${dp.padEnd(7)} ${String(n).padStart(3)} atoms${m.length ? '  ' + m.join(', ') : ''}`);
console.log(`  voice ${v}  boundaries ${bd}  decision calls ${dc}  calibration questions ${qs}`);
console.log(progress);
if (leftLine) console.log(`Left: ${leftLine}.`);
if (dumps.files) console.log(`Dumps: ${dumps.files} (${dumps.words} words): ${dumpAtoms} points, ${dumpItems} checklist items filled from dumps alone.`);
if (edge.audited) console.log(`Edge: of ${edge.audited} points checked against a free AI, ${edge.edge} beat it, ${edge.partial} partly, ${edge.generic} it already gives${edge.unchecked ? `; ${edge.unchecked} not checked yet` : ''}.`);
if (duel.picks || duel.sparred) {
  const parts = [];
  if (duel.sparred) parts.push(`${duel.sparred} questions sparred, the free AI already right in ${duel.plain_right}`);
  if (duel.window) parts.push(`your agent won ${Math.round(100 * duel.win_rate)}% of the last ${duel.window} checks against the free AI`);
  console.log(`Checks: ${parts.join('; ')}.`);
}
const structural = gaps.filter((g) => !/rating|contradiction|head-to-head/.test(g));
const level = gaps.length === 0 ? 'high' : structural.length <= 3 ? 'medium' : 'low';
console.log(`Readiness: ${level}${gaps.length ? '  (' + gaps.length + ' gaps)' : ''}`);
process.exit(gaps.length === 0 ? 0 : 1);
