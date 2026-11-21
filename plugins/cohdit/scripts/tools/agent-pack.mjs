// Claude agent adapter: one expert's repo in, one agent pack out. The pack is what a chat app loads to let people
// talk with the expert's knowledge: a system prompt built from profile, voice, boundaries, decision calls and every
// confirmed atom, plus the starter questions from starters.md. Pure: reads files, returns an object, writes nothing.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readAtoms } from './lib.mjs';

export const PACK_SCHEMA = 1;

function readText(dir, name) {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : '';
}

/** The part of a markdown file under its title and intro lines that only explain the file: its bullet lines. */
function bullets(md) {
  return md.split('\n').map((l) => l.trim()).filter((l) => /^[-*] /.test(l)).map((l) => l.slice(2).trim()).filter(Boolean);
}

/** Profile without its working sections (Status), which talk about the interview, not the expert. */
function profileText(md) {
  return md.replace(/^## Status\b[\s\S]*?(?=^## |(?![\s\S]))/m, '').trim();
}

/** Cross-references to atom and lesson ids mean nothing to the person chatting; drop them. */
export function stripRefs(text) {
  return text
    .replace(/\s*\((?:see\s+)?[AL]-\d{3}(?:\s*(?:,|and)\s*[AL]-\d{3})*\)/gi, '')
    .replace(/(?:^|\s)See [AL]-\d{3}[^.]*\./g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function atomText(a) {
  const lines = [`- ${stripRefs(a.statement)}`];
  if (a.when) lines.push(`  When: ${stripRefs(a.when)}`);
  if (a.place) lines.push(`  Where: ${stripRefs(a.place)}`);
  const why = stripRefs(a.why || (a.ext && a.ext.hatch && a.ext.hatch.detail) || '');
  if (why && why !== a.statement) lines.push(`  Why: ${why}`);
  if (a.unless) lines.push(`  Unless: ${stripRefs(a.unless)}`);
  if (a.example) lines.push(`  Example: ${stripRefs(a.example)}`);
  if (a.corrects) lines.push(`  The usual advice you correct: ${stripRefs(a.corrects)}`);
  if (a.practice) lines.push(`  Common practice: ${stripRefs(a.practice)}`);
  if (a.firm) lines.push('  Firm: your deliberate stance; it stands even where common practice differs.');
  return lines.join('\n');
}

/** With drafts: true, unreviewed drafts are included too (for the expert's own head-to-head tests, never for release). */
export function buildPack(dir, { drafts = false } = {}) {
  const expert = JSON.parse(readText(dir, 'expert.json') || '{}');
  if (!expert.slug || !expert.name) throw new Error('expert.json needs slug and name');
  const atoms = readAtoms(dir).map((x) => x.atom).filter((a) => a.status === 'confirmed' || (drafts && a.status === 'draft'))
    .sort((a, b) => a.id.localeCompare(b.id));
  if (atoms.length === 0) throw new Error('no confirmed atoms: nothing for the agent to know');

  const byDomain = new Map();
  for (const a of atoms) { const d = a.domain[0]; if (!byDomain.has(d)) byDomain.set(d, []); byDomain.get(d).push(a); }

  const voice = bullets(readText(dir, 'voice.md'));
  const boundaries = bullets(readText(dir, 'boundaries.md'));
  const decisions = bullets(readText(dir, 'decisions.md'));
  const starters = bullets(readText(dir, 'starters.md'));

  const parts = [
    `You are the Ten Years agent built from the experience of ${expert.name}. You speak for them, in the first person, to someone who asked for their view.`,
    '',
    '# Who you are',
    profileText(readText(dir, 'profile.md')),
    '',
    '# How to answer',
    '- Answer from the knowledge below. When it covers the question, say what you would do and why, the way you would to a colleague.',
    '- When it does not, you may use general knowledge, but say plainly that this is general knowledge and not your own experience.',
    '- Ask one short question back when the situation decides the answer and you cannot tell which it is.',
    '- Be practical and brief: a few short paragraphs or a short list. No headings unless asked.',
    '- Never invent stories, numbers, names or credentials that are not in the knowledge below.',
    '- Where a point names the usual advice it corrects, and the person may have heard that advice, say briefly how your view differs and why.',
    '- A point with a When applies to that situation; one with a Where holds only there, so check the place when it matters.',
    '',
    '# Your view and common practice',
    '- A point marked Firm is your deliberate stance: follow it, and say it is your own call where common practice differs.',
    '- A point with a Common practice note: give your view, then that practice and when it may suit better.',
    '- Any other point that clearly contradicts well-established practice in your field: lead with that practice, and offer your view as one person\'s experience. Your experience has gaps; do not let it override what the field has firmly established.',
    '- In topics marked light, lead with well-established practice and add your own angle where the knowledge below has one.',
  ];
  if (voice.length) parts.push('', '# How you sound (your own words; borrow the phrasing, do not quote them back)', ...voice.map((v) => `- ${v}`));
  if (boundaries.length) parts.push('', '# Where you stop', ...boundaries.map((b) => `- ${stripRefs(b)}`));
  if (decisions.length) parts.push('', '# Your trade-off calls', ...decisions.map((d) => `- ${stripRefs(d)}`));
  parts.push('', '# What you know');
  for (const d of [...byDomain.keys()].sort()) {
    const light = (expert.depth || {})[d] === 'light' ? ' (light: lead with common practice)' : '';
    parts.push('', `## ${d[0].toUpperCase()}${d.slice(1)}${light}`, ...byDomain.get(d).map(atomText));
  }
  const system = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';

  const body = { schema: PACK_SCHEMA, slug: expert.slug, name: expert.name, atoms: atoms.length, starters, system };
  const sha = crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex').slice(0, 16);
  return { ...body, sha };
}
