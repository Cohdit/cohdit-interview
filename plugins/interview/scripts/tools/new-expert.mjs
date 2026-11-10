// Set up a new expert: a private knowledge repo with the standard layout, listed in experts.json.
// Usage: node scripts/new-expert.mjs --name "Full Name" --slug short-name [--field "what they know"]
//          [--parent <folder, default: the folder beside this repo>] [--create-remote [--owner <github account or org>, default from experts.json]]
// Local only unless --create-remote is given; that creates a PRIVATE repo with the gh CLI and pushes.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k) => args.includes(`--${k}`);
const die = (m) => { console.error(m); process.exit(1); };

const name = opt('name');
const slug = opt('slug');
if (!name || !slug) die('Usage: new-expert.mjs --name "Full Name" --slug short-name [--field "..."] [--create-remote --owner <org>]');
if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) die('slug: lower-case letters, digits and single dashes only');
const field = opt('field') || 'to be found in the first interview';

const here = path.resolve(new URL('..', import.meta.url).pathname);
const parent = path.resolve(opt('parent') || path.join(here, '..'));
const repoName = `cohdit-knowledge-${slug}`;
const dir = path.join(parent, repoName);
const registryFile = process.env.INTERVIEW_REGISTRY || path.join(here, 'experts.json');
const registry = fs.existsSync(registryFile) ? JSON.parse(fs.readFileSync(registryFile, 'utf8')) : { owner: 'delon.leung', experts: [] };
if (registry.experts.some((e) => e.slug === slug)) die(`already registered: ${slug}`);
if (fs.existsSync(dir)) die(`folder exists: ${dir}`);

const files = {
  'expert.json': JSON.stringify({ name, slug, kind: 'person', schema: 1, outputs: [] }, null, 2) + '\n',
  'CLAUDE.md': `# ${repoName}

Private. ${name}'s knowledge as atoms (\`atoms/<domain>/A-NNN.json\`), plus \`profile.md\`, \`decisions.md\`,
\`boundaries.md\` and \`voice.md\`. Tools and schema: \`../cohdit-knowlege-interviewer\`.

- Open this folder in Claude Code with the cohdit-interview plugin and say "interview me".
- The expert in this repo is ${name}. Interview only ${name}; write only here.
- Check before pushing: \`node ../cohdit-knowlege-interviewer/scripts/validate.mjs .\`
- Coverage and gaps: \`node ../cohdit-knowlege-interviewer/scripts/quality.mjs .\`
`,
  'README.md': `# ${repoName}\n\nPrivate knowledge repo for ${name}. Field: ${field}.\n`,
  'profile.md': `# ${name}\n\n## Field\n${field}\n\n## Values that run through the knowledge\n(filled in by interview)\n\n## Voice\n(filled in by interview)\n\n## Status\nNew. No interview yet.\n`,
  'boundaries.md': `# Boundaries\n\nWhat ${name} does not know or will not advise on. The agent must say so instead of guessing as them.\n\n(filled in by interview)\n`,
  'decisions.md': `# Decisions\n\nConventions agreed with ${name} during interviews.\n`,
  'voice.md': `# Voice\n\nHow ${name} speaks, so the agent can match it.\n\n(filled in by interview)\n`,
  'calibration.json': JSON.stringify({ questions: [], ratings: [], contradictions: [] }, null, 2) + '\n',
  'benchmarks.json': fs.readFileSync(new URL('../schema/benchmarks.default.json', import.meta.url), 'utf8'),
  '.gitignore': 'build/\n',
  'atoms/.gitkeep': '',
  'sources/.gitkeep': '',
};
for (const [f, c] of Object.entries(files)) {
  const p = path.join(dir, f);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, c);
}

const sh = (cmd, a, cwd = dir) => execFileSync(cmd, a, { cwd, stdio: 'inherit' });
sh('git', ['init', '-q', '-b', 'main']);
sh('git', ['add', '-A']);
sh('git', ['commit', '-q', '-m', `New expert repo for ${name}`]);

let remote = null;
if (flag('create-remote')) {
  const owner = opt('owner') || registry.owner;
  if (!owner) die('--create-remote needs --owner <github account or org>');
  remote = `${owner}/${repoName}`;
  sh('gh', ['repo', 'create', remote, '--private', '--source', '.', '--remote', 'origin', '--push']);
}

registry.experts.push({ name, slug, repo: repoName, remote, created: new Date().toISOString().slice(0, 10) });
fs.mkdirSync(path.dirname(registryFile), { recursive: true });
fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2) + '\n');
console.log(`created ${dir}${remote ? ` and private remote ${remote}` : ' (local only; add --create-remote to publish)'}`);
console.log('registered in experts.json');
