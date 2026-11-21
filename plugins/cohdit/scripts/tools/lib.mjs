// Shared helpers. An expert's repo is the folder passed to each script: profile.md, benchmarks.json,
// atoms/<domain>/A-NNN.json, voice.md, boundaries.md, decisions.md, calibration.json, sources/, build/.
import fs from 'node:fs';
import path from 'node:path';

export function atomFiles(dir) {
  const out = [];
  const root = path.join(dir, 'atoms');
  if (!fs.existsSync(root)) return out;
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (p.endsWith('.json')) out.push(p);
    }
  })(root);
  return out.sort();
}

export function readAtoms(dir) {
  return atomFiles(dir).map((f) => ({ file: f, atom: JSON.parse(fs.readFileSync(f, 'utf8')) }));
}

// The interview log the plugin's hooks keep in the expert's repo: one JSON line per message, timings and
// question text only. A gap over IDLE_CAP_MS between two messages counts as that much: the person stepped away.
export const LOG_FILE = 'interview-log.jsonl';
export const IDLE_CAP_MS = 10 * 60 * 1000;

export function readLog(dir) {
  const p = path.join(dir, LOG_FILE);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
}

export function timeSpent(events) {
  const bySession = new Map();
  for (const e of events) bySession.set(e.s, [...(bySession.get(e.s) || []), e.t]);
  let ms = 0;
  for (const ts of bySession.values()) {
    ts.sort((a, b) => a - b);
    for (let i = 1; i < ts.length; i++) ms += Math.min(ts[i] - ts[i - 1], IDLE_CAP_MS);
  }
  return { ms, sessions: bySession.size, answers: events.filter((e) => e.e === 'answer').length };
}

// Brain dumps the expert sent, raw, one file each: dumps/<YYYY-MM-DD-HHMM>.md. Atoms taken from one carry
// source "dump:<file name>", so the check can say how much of the checklist the dumps filled.
export function readDumps(dir) {
  const root = path.join(dir, 'dumps');
  if (!fs.existsSync(root)) return { files: 0, words: 0 };
  const files = fs.readdirSync(root).filter((f) => f.endsWith('.md'));
  const words = files.reduce((n, f) => n + (fs.readFileSync(path.join(root, f), 'utf8').match(/\S+/g) || []).length, 0);
  return { files: files.length, words };
}
export const fromDump = (a) => typeof a.source === 'string' && a.source.startsWith('dump:');
