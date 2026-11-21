// Scenarios a real client would bring, answered by plain Claude and by the expert's agent.
// - Sparring: plain Claude answers; the expert corrects only what is wrong or missing. What they correct is the
//   knowledge the agent needs; what plain Claude already gets right needs no interview time.
// - Head-to-head: both answer, shown as A and B in a random order; the expert picks the better one without
//   knowing which is which. The agent's win rate over the latest picks is the readiness bar.
// Scenarios live in scenarios.json in the expert repo; the interviewer writes the questions, this answers them.
// Usage:
//   duel.mjs <repo> run                     answer every scenario that has no answers yet
//   duel.mjs <repo> show <id>               the scenario as the expert sees it (sparring: plain answer; head-to-head: A and B)
//   duel.mjs <repo> pick <id> <A|B|same> [note]   record a head-to-head verdict
//   duel.mjs <repo> mark <id> <ok|fix> [note]     record a sparring reaction (ok: plain Claude was right)
//   duel.mjs <repo> score                   JSON: picks, win rate, sparring agreement by topic
// CLAUDE_BIN overrides the claude command (tests).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildPack } from './agent-pack.mjs';

export const FILE = 'scenarios.json';
export const PLAIN_SYSTEM = 'You are a knowledgeable, practical assistant. Answer the person\'s question as a capable professional in their field would.';
export const ASK_SHORT = '\n\n(Reply in under 90 words of plain text, no markdown, as you would in a chat app.)';
// Kept out of the agent's answer in a head-to-head only, so nothing but the advice tells the two apart.
export const BLIND_NOTE = '\n\n# For this answer\nDo not mention your notes, your knowledge, what is or is not your own experience, or where your view comes from. Just answer.';
export const WINDOW = 15;

export function load(dir) {
  try { return JSON.parse(fs.readFileSync(path.join(dir, FILE), 'utf8')); } catch { return { scenarios: [] }; }
}
function save(dir, data) { fs.writeFileSync(path.join(dir, FILE), JSON.stringify(data, null, 2) + '\n'); }

/** Ask claude once, with no tools, settings, plugins or memory from this machine's projects: a clean answer. */
export function ask(system, question, { timeoutMs = 180000, short = true } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'duel-'));
  const bin = process.env.CLAUDE_BIN || 'claude';
  const args = ['-p', '--tools', '', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence',
    '--system-prompt', system, '--', short ? question + ASK_SHORT : question];
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
      tasks.push(() => ask(pack.system + BLIND_NOTE, s.q).then((a) => { s.expert = a; s.pack = pack.sha; s.atoms = pack.atoms; }));
    }
  }
  const res = await pool(tasks, 4);
  for (const s of todo) if (s.kind === 'duel' && s.plain && s.expert && !s.a) s.a = rand() < 0.5 ? 'expert' : 'plain';
  save(dir, data);
  const failed = res.filter((r) => r.e);
  return { answered: res.length - failed.length, failed: failed.length, error: failed[0]?.e.message };
}

function find(data, id) {
  const s = data.scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`no scenario ${id}`);
  return s;
}

export function show(dir, id) {
  const s = find(load(dir), id);
  if (s.kind === 'spar') return `${s.id} (${s.domain})\n${s.q}\n\nPlain answer:\n${s.plain || '(not answered yet: run first)'}`;
  if (!s.a) return `${s.id}: not answered yet: run first`;
  const [A, B] = s.a === 'expert' ? [s.expert, s.plain] : [s.plain, s.expert];
  return `${s.id} (${s.domain})\n${s.q}\n\nA:\n${A}\n\nB:\n${B}`;
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
  const [dir, cmd, id, arg, ...rest] = process.argv.slice(2);
  const note = rest.join(' ');
  try {
    if (!dir || !cmd) throw new Error('usage: duel.mjs <repo> run|show|pick|mark|score');
    if (cmd === 'run') console.log(JSON.stringify(await run(dir)));
    else if (cmd === 'show') console.log(show(dir, id));
    else if (cmd === 'pick') console.log(JSON.stringify({ id, verdict: pick(dir, id, arg, note) }));
    else if (cmd === 'mark') console.log(JSON.stringify({ id, plain_right: mark(dir, id, arg, note) }));
    else if (cmd === 'score') console.log(JSON.stringify(score(dir)));
    else throw new Error(`unknown command ${cmd}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
