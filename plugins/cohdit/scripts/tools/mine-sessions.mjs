// Turn the expert's own messages in past Claude Code sessions into raw dumps, so what they have already said
// while working (corrections, rules, preferences, reasons) is captured without asking them anything.
// Usage: node scripts/mine-sessions.mjs <expert-repo> [--projects <regex>] [--since YYYY-MM-DD] [--words 6000]
// Reads ~/.claude/projects/*/*.jsonl (override with CLAUDE_PROJECTS_DIR). Writes dumps/mined-<date>-NN.md in the
// expert repo, at most --words words each. Only the person's own typed words are kept: pasted blocks, system
// notes, command output, tool results and anything secret-shaped are dropped. The expert's own interview
// sessions are skipped, since those answers are already atoms. Prints what it found; never prints the text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const repo = path.resolve(args[0] || '');
if (!args[0] || args[0].startsWith('--') || !fs.existsSync(path.join(repo, 'expert.json'))) { console.error('Usage: mine-sessions.mjs <expert-repo> [--projects <regex>] [--since YYYY-MM-DD] [--words N]'); process.exit(1); }
const root = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude/projects');
const only = flag('--projects') ? new RegExp(flag('--projects')) : null;
const since = flag('--since') ? Date.parse(flag('--since')) : 0;
const perFile = Number(flag('--words', 6000));
const MIN_WORDS = 12, MAX_WORDS = 400;

// Claude Code names a project folder after its path, with / and . turned into -.
const own = repo.replace(/[/.]/g, '-');
const skipDir = (d) => d === own || /^-?private-(tmp|var)-/.test(d) || /scratchpad/.test(d);

const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|ik_[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}|[A-Fa-f0-9]{40,}|[A-Za-z0-9+/_-]{48,}={0,2})\b/g;
const BLOCKS = /<(system-reminder|pasted_content|local-command-stdout|local-command-caveat|command-name|command-message|command-args|task-notification|user-prompt-submit-hook)\b[^>]*>[\s\S]*?(?:<\/\1\b[^>]*>|$)/g;

export function ownWords(o) {
  if (o.type !== 'user' || o.isMeta || o.isSidechain || o.toolUseResult) return null;
  const c = o.message?.content;
  const raw = typeof c === 'string' ? c : Array.isArray(c) ? (c.some((x) => x.type === 'tool_result') ? '' : c.filter((x) => x.type === 'text').map((x) => x.text).join('\n')) : '';
  const t = raw.replace(BLOCKS, ' ').replace(SECRET, '[removed]').replace(/\s+\n/g, '\n').trim();
  const n = (t.match(/\S+/g) || []).length;
  if (n < MIN_WORDS || n > MAX_WORDS) return null;
  if (/^\[Request interrupted|^Caveat:|^<[a-z-]+>/i.test(t)) return null;
  // Code or log pastes are not their words: a message that is mostly symbols or very long lines of code.
  if ((t.match(/[{}();=<>$\\]/g) || []).length > n * 0.5) return null;
  return t;
}

const seen = new Set();
const items = [];
let files = 0;
if (fs.existsSync(root)) for (const d of fs.readdirSync(root).sort()) {
  if (skipDir(d) || (only && !only.test(d))) continue;
  const dp = path.join(root, d);
  if (!fs.statSync(dp).isDirectory()) continue;
  for (const f of fs.readdirSync(dp).filter((x) => x.endsWith('.jsonl'))) {
    files++;
    for (const l of fs.readFileSync(path.join(dp, f), 'utf8').split('\n')) {
      if (!l.includes('"type":"user"')) continue;
      let o; try { o = JSON.parse(l); } catch { continue; }
      const t = ownWords(o);
      const ts = Date.parse(o.timestamp || '') || 0;
      if (!t || ts < since) continue;
      const key = t.toLowerCase().replace(/\W+/g, ' ').slice(0, 200);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({ project: d.replace(/^-Users-[^-]+-(git-clones-)?/, ''), ts, t });
    }
  }
}
items.sort((a, b) => a.ts - b.ts);

const out = path.join(repo, 'dumps');
fs.mkdirSync(out, { recursive: true });
const day = new Date().toISOString().slice(0, 10);
let n = fs.readdirSync(out).filter((x) => x.startsWith(`mined-${day}-`)).length;
let words = 0, total = 0, buf = [], written = [];
const flush = () => {
  if (!buf.length) return;
  const name = `mined-${day}-${String(++n).padStart(2, '0')}.md`;
  fs.writeFileSync(path.join(out, name), `# Mined from the expert's past work sessions\n\nTheir own words, as typed to an assistant while working. Not a lecture: read each as a decision, correction or preference.\n\n${buf.join('\n\n')}\n`);
  written.push(name); buf = []; words = 0;
};
for (const it of items) {
  const w = (it.t.match(/\S+/g) || []).length;
  if (words + w > perFile) flush();
  buf.push(`- (${it.project}, ${new Date(it.ts).toISOString().slice(0, 10)}) ${it.t.replace(/\n+/g, '\n  ')}`);
  words += w; total += w;
}
flush();
console.log(JSON.stringify({ sessions: files, messages: items.length, words: total, files: written }));
