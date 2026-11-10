// Thin client for the Cohdit Interview plugin. The interviewer's instructions are fetched at run time;
// the tools (validate, quality, new-expert) are open and ship here, copied by vendor-plugin.mjs.
//   interview.mjs content skill|agent <name>   the instructions, with the plugin's path filled in
//   interview.mjs whoami                       the expert whose repo this is
//   interview.mjs check                        validate and score the expert repo
//   interview.mjs new-expert --name .. --slug .. [--field ..]
// INTERVIEW_KEY or ~/.cohdit-interview/key is the access key. INTERVIEW_API overrides the base URL.
// INTERVIEW_DEV_DIR reads content from a folder ({dir}/skills/<n>/SKILL.md, {dir}/agents/<n>.md): no key, no cache.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const HOME = path.join(os.homedir(), '.cohdit-interview');
const BASE = process.env.INTERVIEW_API || 'https://www.cohdit.com/api/interview/v1';
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const FRESH_MS = 10 * 60 * 1000;
const STALE_MS = 24 * 60 * 60 * 1000;
const MESSAGES = {
  missing: 'Cohdit Interview needs your access key. Put it in ~/.cohdit-interview/key, or write to delon@cohdit.com.',
  inactive: 'Your Cohdit Interview subscription is not active. Write to delon@cohdit.com.',
  revoked: 'This key has been turned off. Write to delon@cohdit.com.',
  wrong_plan: 'Your plan does not include this. Write to delon@cohdit.com.',
  unavailable: 'Cohdit Interview cannot reach Cohdit right now. Try again in a few minutes.',
  not_found: 'Cohdit Interview is missing a part it needs. Update the plugin, or write to delon@cohdit.com.',
};
const fail = (code, extra) => { console.log(`ERROR ${MESSAGES[code] || code}${extra ? ` (${extra})` : ''}`); process.exit(1); };

function key() {
  if (process.env.INTERVIEW_KEY) return process.env.INTERVIEW_KEY.trim();
  try { return fs.readFileSync(path.join(HOME, 'key'), 'utf8').trim(); } catch { return null; }
}

function filePath(kind, name) { return kind === 'skill' ? `skills/${name}/SKILL.md` : `agents/${name}.md`; }

async function content(kind, name) {
  if (!['skill', 'agent'].includes(kind) || !/^[a-z-]+$/.test(name || '')) fail('not_found', 'bad name');
  const text = await fetchText(kind, name);
  return text.replaceAll('${CLAUDE_PLUGIN_ROOT}', ROOT);
}

async function fetchText(kind, name) {
  if (process.env.INTERVIEW_DEV_DIR) {
    try { return fs.readFileSync(path.join(process.env.INTERVIEW_DEV_DIR, filePath(kind, name)), 'utf8'); } catch { fail('not_found', name); }
  }
  const cacheFile = path.join(HOME, 'cache', kind, name);
  let cached = null;
  try { cached = { text: fs.readFileSync(cacheFile, 'utf8'), age: Date.now() - fs.statSync(cacheFile).mtimeMs }; } catch {}
  if (cached && cached.age < FRESH_MS) return cached.text;
  const k = key();
  if (!k) fail('missing');
  try {
    const res = await fetch(`${BASE}/${kind}/${name}`, {
      headers: { Authorization: `Bearer ${k}`, 'X-Interview-Plugin': VERSION },
      signal: AbortSignal.timeout(cached ? 5000 : 15000),
    });
    if (res.status === 200) {
      const text = await res.text();
      fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
      fs.writeFileSync(cacheFile, text);
      return text;
    }
    if (res.status === 403) { fs.rmSync(path.join(HOME, 'cache'), { recursive: true, force: true }); fail((await res.json().catch(() => ({}))).error || 'inactive'); }
    if (res.status === 401) fail('missing');
    if (res.status === 404) fail('not_found', name);
    throw new Error(`status ${res.status}`);
  } catch (e) {
    if (e.exitCode !== undefined) throw e;
    if (cached && cached.age < STALE_MS) return cached.text;
    fail('unavailable');
  }
}

function findExpert(from = process.cwd()) {
  for (let d = path.resolve(from); ; d = path.dirname(d)) {
    const f = path.join(d, 'expert.json');
    if (fs.existsSync(f)) return { dir: d, ...JSON.parse(fs.readFileSync(f, 'utf8')) };
    if (path.dirname(d) === d) return null;
  }
}

// Runs a bundled tool; returns its exit code. quality.mjs exits 1 when readiness is not high, which is a report, not a crash.
function tool(name, args, env = {}) {
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts/tools', name), ...args], { stdio: 'inherit', env: { ...process.env, ...env } });
    return 0;
  } catch (e) {
    if (typeof e.status === 'number') return e.status;
    throw e;
  }
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'content') {
  console.log(await content(rest[0], rest[1]));
} else if (cmd === 'whoami') {
  const e = findExpert();
  if (!e) { console.log('No expert.json here. This folder is not an expert repo.'); process.exit(1); }
  console.log(`${e.name} (${e.kind})\nrepo: ${e.dir}`);
} else if (cmd === 'check') {
  const e = findExpert();
  if (!e) { console.log('No expert.json here. This folder is not an expert repo.'); process.exit(1); }
  const invalid = tool('validate.mjs', [e.dir]);
  tool('quality.mjs', [e.dir]);
  process.exit(invalid ? 1 : 0);
} else if (cmd === 'new-expert') {
  const here = findExpert();
  const parent = here ? path.dirname(here.dir) : process.cwd();
  process.exit(tool('new-expert.mjs', [...rest, '--parent', parent], { INTERVIEW_REGISTRY: path.join(HOME, 'experts.json') }));
} else {
  console.log('Usage: interview.mjs content|whoami|check|new-expert');
  process.exit(1);
}
