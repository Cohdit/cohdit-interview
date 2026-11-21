// Edge audit: which of an expert's points plain Claude already gives on its own, with no time from the expert.
// For each point: write the question a client would ask where the point decides the answer (without hinting at
// it), let plain Claude answer, then judge the answer against the point:
//   edge     plain Claude does not say it, or says otherwise
//   partial  it gets the direction but misses what makes the point useful (a number, an exception, the order)
//   generic  it already says it
// Writes evidence {edge, note, checked, model} into each atom, and `corrects` (what plain Claude said instead)
// where the atom has none. With --report <file>, writes nothing in the repo: the results go to that file.
// Usage: edge-audit.mjs <repo> [--all] [--ids A-001,A-002] [--report <file>] [--model <id>]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readAtoms } from './lib.mjs';
import { ask, pool, PLAIN_SYSTEM } from './duel.mjs';

const WRITER = 'You write realistic questions that clients or junior practitioners bring to an expert. Reply with JSON only.';
const JUDGE = 'You compare advice strictly and briefly. Reply with JSON only.';
export const BATCH = 15;

/** The first JSON object or array in a reply, ignoring code fences and chatter around it. */
export function parseJson(text) {
  const s = text.replace(/```(?:json)?/g, '');
  const start = s.search(/[[{]/);
  if (start < 0) throw new Error('no JSON in reply');
  for (let end = s.length; end > start; end--) {
    try { return JSON.parse(s.slice(start, end)); } catch {}
  }
  throw new Error('no JSON in reply');
}

const brief = (a) => ({ id: a.id, domain: a.domain, statement: a.statement, why: a.why, unless: a.unless, when: a.when, place: a.place });

export function questionPrompt(atoms, niche) {
  return [
    niche ? `The expert serves: ${niche}.` : '',
    'For each point below, write the question a real client or junior practitioner would ask in the situation where this point decides the answer.',
    'Give the details that matter (place, numbers, constraints), in their words. Never hint at the point itself or its answer.',
    'Reply as a JSON object mapping each id to its question.',
    '',
    JSON.stringify(atoms.map(brief), null, 1),
  ].filter((l) => l !== '').join('\n');
}

export function judgePrompt(a, question, answer) {
  return [
    'An expert holds this point:',
    JSON.stringify(brief(a), null, 1),
    '',
    `A person asked: ${question}`,
    '',
    'A capable assistant answered:',
    answer,
    '',
    'Does the answer already give the point? Judge strictly:',
    '- "generic": it gives the same advice, including the specific number, condition, exception or priority that makes the point useful.',
    '- "partial": it points the same way but misses or buries what makes the point useful, or lists it as one option among many.',
    '- "edge": it does not say it, or advises otherwise.',
    'Reply with JSON: {"edge": "generic" | "partial" | "edge", "note": "<what the answer said or missed, under 25 words>", "plain_says": "<the answer\'s own advice on this, one sentence>"}',
  ].join('\n');
}

export async function audit(dir, { all = false, ids = null, concurrency = 6, log = () => {} } = {}) {
  const expert = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'expert.json'), 'utf8')); } catch { return {}; } })();
  const n = expert.niche || {};
  const niche = [n.who, n.where, n.problem].filter(Boolean).join(', ');
  const items = readAtoms(dir).filter(({ atom: a }) => (a.status === 'confirmed' || a.status === 'draft')
    && (ids ? ids.includes(a.id) : all || !(a.evidence && a.evidence.checked)));
  const results = [];
  if (!items.length) return results;
  // 1. Questions, in batches.
  const questions = {};
  const batches = [];
  for (let i = 0; i < items.length; i += BATCH) batches.push(items.slice(i, i + BATCH).map((x) => x.atom));
  await pool(batches.map((b) => async () => {
    Object.assign(questions, parseJson(await ask(WRITER, questionPrompt(b, niche), { short: false })));
    log(`questions ${Object.keys(questions).length}/${items.length}`);
  }), concurrency);
  // 2. Plain answers and 3. judgements, one point at a time.
  let done = 0;
  const out = await pool(items.map(({ file, atom: a }) => async () => {
    const q = questions[a.id];
    if (!q) throw new Error(`no question for ${a.id}`);
    const plain = await ask(PLAIN_SYSTEM, q, { short: false });
    const j = parseJson(await ask(JUDGE, judgePrompt(a, q, plain), { short: false }));
    if (!['generic', 'partial', 'edge'].includes(j.edge)) throw new Error(`bad judgement for ${a.id}`);
    log(`judged ${++done}/${items.length}`);
    return { file, id: a.id, domain: a.domain, statement: a.statement, q, plain, edge: j.edge, note: j.note || '', plain_says: j.plain_says || '' };
  }), concurrency);
  for (const r of out) if (r.v) results.push(r.v); else results.push({ error: r.e.message });
  return results;
}

export function summarise(results) {
  const ok = results.filter((r) => !r.error);
  const count = (list) => ({ edge: list.filter((r) => r.edge === 'edge').length, partial: list.filter((r) => r.edge === 'partial').length, generic: list.filter((r) => r.edge === 'generic').length });
  const domains = [...new Set(ok.flatMap((r) => r.domain))].sort();
  return { audited: ok.length, failed: results.length - ok.length, ...count(ok), by_topic: Object.fromEntries(domains.map((d) => [d, count(ok.filter((r) => r.domain.includes(d)))])) };
}

export function writeEvidence(results, { model, today = new Date().toISOString().slice(0, 10) } = {}) {
  for (const r of results) {
    if (r.error) continue;
    const a = JSON.parse(fs.readFileSync(r.file, 'utf8'));
    a.evidence = { ...(a.evidence || {}), edge: r.edge, note: r.note.slice(0, 300), checked: today, model };
    if (r.edge !== 'generic' && !a.corrects && r.plain_says) a.corrects = r.plain_says.slice(0, 400);
    fs.writeFileSync(r.file, JSON.stringify(a, null, 2) + '\n');
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  { const mi = args.indexOf('--model'); if (mi >= 0) { process.env.DUEL_MODEL = args[mi + 1]; args.splice(mi, 2); } }
  const dir = args[0];
  const opt = (k) => { const i = args.indexOf(k); return i > 0 ? args[i + 1] : null; };
  if (!dir) { console.error('usage: edge-audit.mjs <repo> [--all] [--ids A-001,A-002] [--report <file>]'); process.exit(2); }
  let model = 'claude';
  try { model = execFileSync(process.env.CLAUDE_BIN || 'claude', ['--version'], { encoding: 'utf8' }).trim().split('\n')[0]; } catch {}
  model = process.env.DUEL_MODEL ? `${process.env.DUEL_MODEL} (${model})` : model;
  const results = await audit(dir, { all: args.includes('--all'), ids: opt('--ids') ? opt('--ids').split(',') : null, log: (m) => process.stderr.write(`\r${m}   `) });
  process.stderr.write('\n');
  const summary = summarise(results);
  const report = opt('--report');
  if (report) fs.writeFileSync(report, JSON.stringify({ model, summary, results: results.map(({ file, ...r }) => r) }, null, 2) + '\n');
  else writeEvidence(results, { model });
  console.log(JSON.stringify(summary));
}
