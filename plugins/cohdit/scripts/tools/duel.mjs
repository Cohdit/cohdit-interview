// Scenarios a real client would bring, answered by plain Claude and by the expert's agent.
// - Sparring: plain Claude answers; the expert corrects only what is wrong or missing. What they correct is the
//   knowledge the agent needs; what plain Claude already gets right needs no interview time.
// - Head-to-head: both answer, shown as A and B in a random order; the expert picks the better one without
//   knowing which is which. The agent's win rate over the latest picks is the readiness bar.
// Scenarios live in scenarios.json in the expert repo; the interviewer writes the questions, this answers them.
// Usage:
//   duel.mjs <repo> run [--model <id>]      answer every scenario that has no answers yet, both sides with that model
//   duel.mjs <repo> show <id>               the scenario as the expert sees it (sparring: plain answer; head-to-head: A and B)
//   duel.mjs <repo> pick <id> <A|B|same> [note]   record a head-to-head verdict
//   duel.mjs <repo> mark <id> <ok|fix> [note]     record a sparring reaction (ok: plain Claude was right)
//   duel.mjs <repo> score                   JSON: picks, win rate, sparring agreement by topic
//   duel.mjs <repo> next                    what to do next: spar <id>, check <id>, run, or write more
// CLAUDE_BIN overrides the claude command (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPack } from './agent-pack.mjs';

export const FILE = 'scenarios.json';
export const PLAIN_SYSTEM = 'You are a knowledgeable, practical assistant. Answer the person\'s question as a capable professional in their field would.';
export const ASK_SHORT = '\n\n(Reply in under 70 words of plain text, no markdown, as you would in a chat app.)';
// Kept out of the agent's answer in a head-to-head only, so nothing but the advice tells the two apart.
export const BLIND_NOTE = '\n\n# For this answer\nDo not mention your notes, your knowledge, what is or is not your own experience, or where your view comes from. Just answer.';
export const WINDOW = 15;

export function load(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch { return { scenarios: [] }; }
}
function save(dir, data) { fs.writeFileSync(path.join(dir, FILE), JSON.stringify(data, null, 2) + '\n'); }

/** Ask claude once, with no tools, settings, plugins or memory from this machine's projects: a clean answer. */
// The model both sides answer with: the one the expert is using in this session (the interviewer passes it with
// --model), so the only difference between the two answers is the expert's knowledge. Unset, claude's default.
export function ask(system, question, { timeoutMs = 180000, short = true, model = process.env.DUEL_MODEL } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duel-'));
  const bin = process.env.CLAUDE_BIN || 'claude';
  const args = ['-p', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    ...(model ? ['--model', model] : []), '--system-prompt', system, '--', short ? question + ASK_SHORT : question];
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: tmp, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(tmp, { recursive: true, force: true });
      if (code === 0 && out.trim()) resolve(out.trim());
      else reject(new Error(`claude exited ${code}: ${err.trim().split('\n').pop() || 'no answer'}`));
    });
  });
}

export async function pool(tasks, n) {
  const results = [];
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => {
    while (i < tasks.length) { const k = i++; results[k] = await tasks[k]().then((v) => ({ v }), (e) => ({ e })); }
  }));
  return results;
}

export async function run(dir, { rand = Math.random } = {}) {
  const data = load(dir);
  const todo = data.scenarios.filter((s) => !s.plain || (s.kind === 'duel' && !s.expert));
  if (!todo.length) return { answered: 0, failed: 0 };
  const needPack = todo.some((s) => s.kind === 'duel');
  const pack = needPack ? buildPack(dir, { drafts: true }) : null;
  const tasks = [];
  for (const s of todo) {
    if (!s.plain) tasks.push(() => ask(PLAIN_SYSTEM, s.q).then((a) => { s.plain = a; }));
    if (s.kind === 'duel' && !s.expert) {
      tasks.push(() => ask(pack.system + BLIND_NOTE, s.q).then((a) => { s.expert = a; s.pack = pack.sha; s.atoms = pack.atoms; s.model = process.env.DUEL_MODEL || 'default'; }));
    }
  }
  const res = await pool(tasks, 4);
  // Duels answered together form one round, so the expert sees "2 of 5".
  const round = new Date().toISOString();
  for (const s of todo) if (s.kind === 'duel' && s.plain && s.expert && !s.a) { s.a = rand() < 0.5 ? 'expert' : 'plain'; s.round = round; }
  save(dir, data);
  const failed = res.filter((r) => r.e);
  return { answered: res.length - failed.length, failed: failed.length, error: failed[0]?.e.message };
}

function find(data, id) {
  const s = data.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

/** An answer with its opening in bold (its first sentence, or two when the first is a bare "Sure."), so the
 * gist reads at a glance. */
export function lead(text) {
  const t = text.replace(/\*\*/g, '').trim();
  const ends = [...t.matchAll(/[.!?](?=\s|$)/g)].map((m) => m.index + 1);
  const cut = ends.find((i) => i >= 30) ?? ends.at(-1);
  if (!cut || cut > 240) return t;
  return `**${t.slice(0, cut)}**${t.slice(cut)}`;
}

// What the expert reads the first time each kind of turn comes up: what is going on and why, in plain words.
export const FIRST_SPAR = [
  'Here is how this works. I show you a question a client of yours might ask, and the answer a free AI gives today.',
  'Tell me what is wrong or missing, the way you would correct a junior. If it is fine, just say "fine".',
  'Your corrections are what make your agent better than the free answer; what the free AI already knows costs you nothing.',
  'Answer whenever you have a minute. Each question stands on its own, so there is nothing to remember from last time, and everything is saved as you go.',
].join('\n');
export const FIRST_TIME = [
  'A quick check on your agent. Every few questions I will show you one of these.',
  'Two answers to the same client question: one from your agent, built from what you have told me, and one from a free AI. You are not told which is which.',
  'Both use the same AI model you are using right now, so the only difference is what you have taught your agent.',
  'Pick the one you would rather your client got. Afterwards I tell you which was yours. When your agent wins most of these, it is ready to earn.',
].join('\n');
export const ASK_SPAR = '**What is wrong or missing? "Fine" if nothing.**';
export const ASK_PICK = '**A, B or same?** (a few words on why are welcome, never needed)';
const BENCH = (() => { try { return JSON.parse(fs.readFileSync(new URL('../schema/benchmarks.default.json', import.meta.url), 'utf8')).head_to_head; } catch { return { min_picks: 15, min_win_rate: 0.6, early: [{ picks: 6, wins: 6 }, { picks: 10, wins: 8 }] }; } })();

export function show(dir, id) {
  const data = load(dir);
  const s = find(data, id);
  if (s.kind === 'spar') {
    if (!s.plain) return `${s.id}: not answered yet: run first`;
    const first = !data.scenarios.some((x) => x.kind === 'spar' && typeof x.agree === 'boolean');
    return [first ? FIRST_SPAR + '\n' : '', `A client asks: ${s.q}`, '', `The free answer: ${lead(s.plain)}`, '', ASK_SPAR]
      .filter((l, i) => i > 0 || l).join('\n');
  }
  if (!s.a) return `${s.id}: not answered yet: run first`;
  const [A, B] = s.a === 'expert' ? [s.expert, s.plain] : [s.plain, s.expert];
  const picked = data.scenarios.filter((x) => x.kind === 'duel' && x.verdict).length;
  return [
    picked === 0 ? FIRST_TIME + '\n' : '',
    `Check ${picked + 1} · ${s.brief || s.q}`,
    '',
    `A: ${lead(A)}`,
    '',
    `B: ${lead(B)}`,
    '',
    ASK_PICK,
  ].filter((l, i) => i > 0 || l).join('\n');
}

/**
 * Is the agent ready? Clearly winning early is enough: 6 wins in the first 6 checks, or 8 in 10; otherwise
 * 60% of the latest 15. A tie counts half. Returns { ready, wins, n }.
 */
export function readiness(dir) {
  const rules = [...(BENCH.early || []), { picks: BENCH.min_picks, wins: BENCH.min_picks * BENCH.min_win_rate }];
  const all = score(dir, BENCH.min_picks);
  for (const r of rules) {
    const sc = score(dir, r.picks);
    if (sc.window >= r.picks && sc.wins + sc.ties / 2 >= r.wins) return { ready: true, wins: sc.wins, n: sc.window };
  }
  return { ready: false, wins: all.wins, ties: all.ties, n: all.window };
}

/** The plain-words result of a pick: which answer was the agent's, and where it stands. Calm, never a quota. */
export function told(dir, id) {
  const s = find(load(dir), id);
  const yours = s.a === 'expert' ? 'A' : 'B';
  const what = { expert: `${yours} was your agent: it won.`, plain: `${yours} was your agent: the free answer won this one.`, same: `${yours} was your agent: a tie.` }[s.verdict];
  const r = readiness(dir);
  const tally = `${r.wins} ${r.wins === 1 ? 'win' : 'wins'} out of ${r.n}`;
  if (r.ready) return `${what} That makes ${tally}: your agent is ready to earn.`;
  return `${what} ${tally} so far. A few more of these will come up as we go.`;
}

/**
 * What the interview does next, so checks come up on their own while the expert shares what they know:
 * a waiting sparring scenario first; after every EVERY sparring reactions, a check if one is ready;
 * when nothing is waiting, write more: 3 sparring scenarios, plus 1 check unless one is already waiting.
 */
export const EVERY = 3;
export function next(dir) {
  const all = load(dir).scenarios;
  const lastPick = all.filter((x) => x.kind === 'duel' && x.verdict).map((x) => String(x.at)).sort().at(-1) || '';
  const since = all.filter((x) => x.kind === 'spar' && typeof x.agree === 'boolean' && String(x.at) > lastPick).length;
  const duel = all.find((x) => x.kind === 'duel' && x.a && !x.verdict);
  if (duel && since >= EVERY) return { do: 'check', id: duel.id };
  const spar = all.find((x) => x.kind === 'spar' && x.plain && typeof x.agree !== 'boolean');
  if (spar) return { do: 'spar', id: spar.id };
  // A check that is waiting still comes only after 3 sparring answers, never back to back.
  const unanswered = all.some((x) => !x.plain || (x.kind === 'duel' && !x.a));
  if (unanswered) return { do: 'run' };
  return { do: 'write', spar: EVERY, check: all.some((x) => x.kind === 'duel' && !x.verdict) ? 0 : 1 };
}

export function pick(dir, id, choice, note) {
  const data = load(dir);
  const s = find(data, id);
  if (s.kind !== 'duel' || !s.a) throw new Error(`${id} is not an answered head-to-head`);
  const c = String(choice).toUpperCase();
  if (!['A', 'B', 'SAME'].includes(c)) throw new Error('pick A, B or same');
  s.verdict = c === 'SAME' ? 'same' : (c === 'A') === (s.a === 'expert') ? 'expert' : 'plain';
  if (note) s.note = note;
  s.at = new Date().toISOString();
  save(dir, data);
  return s.verdict;
}

export function mark(dir, id, reaction, note) {
  const data = load(dir);
  const s = find(data, id);
  if (s.kind !== 'spar') throw new Error(`${id} is not a sparring scenario`);
  if (!['ok', 'fix'].includes(reaction)) throw new Error('mark ok or fix');
  s.agree = reaction === 'ok';
  if (note) s.note = note;
  s.at = new Date().toISOString();
  save(dir, data);
  return s.agree;
}

/** Win rate over the latest WINDOW picks (a tie counts half), so the score follows the agent as it is now. */
export function score(dir, window = WINDOW) {
  const all = load(dir).scenarios;
  const picked = all.filter((s) => s.kind === 'duel' && s.verdict).sort((a, b) => String(a.at).localeCompare(String(b.at)));
  const last = picked.slice(-window);
  const w = last.filter((s) => s.verdict === 'expert').length, t = last.filter((s) => s.verdict === 'same').length;
  const spar = all.filter((s) => s.kind === 'spar' && typeof s.agree === 'boolean');
  const byTopic = {};
  for (const s of spar) { const b = (byTopic[s.domain] ||= { sparred: 0, plain_right: 0 }); b.sparred++; if (s.agree) b.plain_right++; }
  return {
    picks: picked.length, window: last.length, wins: w, ties: t, losses: last.length - w - t,
    win_rate: last.length ? Math.round((1000 * (w + t / 2)) / last.length) / 1000 : null,
    waiting: all.filter((s) => s.kind === 'duel' && s.a && !s.verdict).length,
    sparred: spar.length, plain_right: spar.filter((s) => s.agree).length, by_topic: byTopic,
  };
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const argv = process.argv.slice(2);
  const mi = argv.indexOf('--model');
  if (mi >= 0) { process.env.DUEL_MODEL = argv[mi + 1]; argv.splice(mi, 2); }
  const [dir, cmd, id, arg, ...rest] = argv;
  const note = rest.join(' ');
  try {
    if (!dir || !cmd) throw new Error('usage: duel.mjs <repo> run|next|show|pick|mark|score');
    if (cmd === 'run') console.log(JSON.stringify(await run(dir)));
    else if (cmd === 'show') console.log(show(dir, id));
    else if (cmd === 'pick') { const verdict = pick(dir, id, arg, note); console.log(JSON.stringify({ id, verdict, say: told(dir, id) })); }
    else if (cmd === 'next') console.log(JSON.stringify(next(dir)));
    else if (cmd === 'mark') console.log(JSON.stringify({ id, plain_right: mark(dir, id, arg, note) }));
    else if (cmd === 'score') console.log(JSON.stringify(score(dir)));
    else throw new Error(`unknown command ${cmd}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
