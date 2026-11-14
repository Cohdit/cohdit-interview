// Interview time and usage stats, kept by the plugin's hooks so nothing depends on the interviewer remembering.
// Locally: <expert repo>/interview-log.jsonl, one line per message: answers as a word count, questions as text.
// Centrally: the same lines plus a snapshot of progress go to Cohdit, unless the person said "stop sharing stats".
// Never sends an answer's text. Every failure is silent: a hook must never get in the way of the interview.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

const LOG = 'interview-log.jsonl';
const UPLOAD_EVERY_MS = 10 * 60 * 1000;

export function makeStats({ HOME, ROOT, BASE, VERSION, key, findExpert }) {
  const state = path.join(HOME, 'stats.json');
  const off = path.join(HOME, 'no-stats');
  const notice = path.join(HOME, 'stats-notice');
  const readState = () => { try { return JSON.parse(fs.readFileSync(state, 'utf8')); } catch { return {}; } };
  const writeState = (s) => { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(state, JSON.stringify(s)); };
  const append = (dir, ev) => fs.appendFileSync(path.join(dir, LOG), JSON.stringify(ev) + '\n');
  const readLog = (dir) => {
    try { return fs.readFileSync(path.join(dir, LOG), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
  };

  /** The text of the last assistant turn in a transcript (read from the end, so a long session stays cheap). */
  function lastAssistantText(file) {
    let buf;
    try {
      const fd = fs.openSync(file, 'r');
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, 512 * 1024);
      buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      fs.closeSync(fd);
    } catch { return null; }
    const lines = buf.toString('utf8').split('\n').reverse();
    for (const l of lines) {
      let o; try { o = JSON.parse(l); } catch { continue; }
      if (o.type === 'user' && textOf(o)) return null;
      if (o.type === 'assistant') { const t = textOf(o); if (t) return t; }
    }
    return null;
  }

  function field(e) {
    if (e.field) return String(e.field).slice(0, 120);
    try {
      const md = fs.readFileSync(path.join(e.dir, 'profile.md'), 'utf8');
      const m = /^## Field\s*\n+([^\n]+)/m.exec(md) || /^# .*\n+([^#\n][^\n]*)/m.exec(md);
      return m ? m[1].trim().slice(0, 120) : '';
    } catch { return ''; }
  }

  function snapshot(dir) {
    try {
      const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/tools/quality.mjs'), dir, '--json'], { encoding: 'utf8', timeout: 5000 });
      const j = JSON.parse(out);
      return { atoms: j.atoms, topics: j.topics, depth: j.depth, progress: j.progress, left: j.left };
    } catch { return { atoms: { draft: 0, confirmed: 0, retired: 0 }, topics: {}, depth: {}, progress: null, left: null }; }
  }

  /** Sends the log lines Cohdit has not had yet, at most every 10 minutes unless forced. */
  async function upload(e, force) {
    if (fs.existsSync(off) || !key()) return;
    const s = readState();
    const mine = s[e.dir] || { n: 0, at: 0 };
    if (!force && Date.now() - mine.at < UPLOAD_EVERY_MS) return;
    const log = readLog(e.dir);
    if (mine.n > log.length) mine.n = 0;
    const fresh = log.slice(mine.n);
    if (!fresh.length) return;
    const expert = crypto.createHash('sha256').update(`${e.slug}|${e.name}`).digest('hex').slice(0, 16);
    const snap = snapshot(e.dir);
    for (let i = 0; i < fresh.length; i += 500) {
      const events = fresh.slice(i, i + 500).map((x) => (x.e === 'answer' ? { t: x.t, s: x.s, e: x.e, words: x.words } : { t: x.t, s: x.s, e: x.e, text: String(x.text).slice(0, 2000) }));
      try {
        const res = await fetch(`${BASE}/stats`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json', 'X-Interview-Plugin': VERSION },
          body: JSON.stringify({ expert, field: field(e), plugin: VERSION, events, snapshot: snap }),
          signal: AbortSignal.timeout(4000),
        });
        if (!res.ok) return;
      } catch { return; }
      mine.n += events.length;
      mine.at = Date.now();
      writeState({ ...readState(), [e.dir]: mine });
    }
  }

  /** One hook call. `kind` is prompt, stop or end; the hook's JSON arrives on stdin. Prints only context for Claude. */
  async function hook(kind) {
    let input = {};
    try { input = JSON.parse(fs.readFileSync(0, 'utf8') || '{}'); } catch {}
    const e = findExpert(input.cwd || process.cwd());
    if (!e) return;
    const s = input.session_id || 'unknown';
    if (kind === 'prompt') {
      const prompt = String(input.prompt || '');
      if (/\bstop sharing (my )?stats\b/i.test(prompt)) {
        fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(off, new Date().toISOString());
        console.log('Cohdit Interview: stats sharing is now off on this computer. Confirm that to the person in one short line. Their own time total still works.');
      } else if (/\b(start|resume) sharing (my )?stats\b/i.test(prompt)) {
        fs.rmSync(off, { force: true });
        console.log('Cohdit Interview: stats sharing is back on. Confirm that to the person in one short line.');
      } else if (!fs.existsSync(notice) && !fs.existsSync(off)) {
        fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(notice, new Date().toISOString());
        console.log('Cohdit Interview: before anything else in your reply, tell the person once, in one short line: "To improve this tool, Cohdit receives how long you spend and the questions I ask, never your answers. Say \'stop sharing stats\' to turn that off."');
      }
      if (!prompt.startsWith('<')) append(e.dir, { t: Date.now(), s, e: 'answer', words: prompt.split(/\s+/).filter(Boolean).length });
    } else if (kind === 'stop') {
      const text = input.transcript_path ? lastAssistantText(input.transcript_path) : null;
      if (text) append(e.dir, { t: Date.now(), s, e: 'question', text: text.slice(0, 2000) });
      await upload(e, false);
    } else if (kind === 'end') {
      await upload(e, true);
    }
  }

  /** Rebuilds the log from this computer's earlier Claude Code sessions in the expert's repo (only if there is no log yet). */
  function backfill(e) {
    if (fs.existsSync(path.join(e.dir, LOG))) return 'There is already a log here; nothing to do.';
    const folder = path.join(os.homedir(), '.claude', 'projects', e.dir.replace(/[^a-zA-Z0-9]/g, '-'));
    let files = [];
    try { files = fs.readdirSync(folder).filter((f) => f.endsWith('.jsonl')); } catch {}
    const out = [];
    for (const f of files) {
      let lastText = null;
      for (const l of fs.readFileSync(path.join(folder, f), 'utf8').split('\n')) {
        let o; try { o = JSON.parse(l); } catch { continue; }
        const t = Date.parse(o.timestamp);
        if (!t || o.isSidechain || o.isMeta) continue;
        const text = textOf(o);
        if (!text) continue;
        if (o.type === 'assistant') lastText = text;
        else if (o.type === 'user' && !text.startsWith('<')) {
          if (lastText) out.push({ t: t - 1, s: o.sessionId || f, e: 'question', text: lastText.slice(0, 2000) });
          out.push({ t, s: o.sessionId || f, e: 'answer', words: text.split(/\s+/).filter(Boolean).length });
          lastText = null;
        }
      }
    }
    out.sort((a, b) => a.t - b.t);
    if (out.length) fs.writeFileSync(path.join(e.dir, LOG), out.map((x) => JSON.stringify(x)).join('\n') + '\n');
    return `Rebuilt ${out.length} messages from ${files.length} earlier sessions.`;
  }

  function setSharing(on) {
    fs.mkdirSync(HOME, { recursive: true });
    if (on) fs.rmSync(off, { force: true }); else fs.writeFileSync(off, new Date().toISOString());
    return on ? 'Stats sharing is on.' : 'Stats sharing is off. Your own time total still works.';
  }

  return { hook, backfill, setSharing };
}

function textOf(o) {
  const c = o.message && o.message.content;
  if (typeof c === 'string') return c.trim() || null;
  if (!Array.isArray(c) || c.some((x) => x.type === 'tool_result')) return null;
  const t = c.filter((x) => x.type === 'text').map((x) => x.text).join('\n').trim();
  return t || null;
}
