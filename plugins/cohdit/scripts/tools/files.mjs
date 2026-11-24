// The expert's own files (notes, proposals, slides, checklists, post-mortems, spreadsheets) turned into raw dumps,
// so what they have already written is captured without asking them anything.
// Usage: node scripts/files.mjs <expert-repo> [file or folder ...]
// With no paths, reads <expert-repo>/inbox/. The originals are never copied into the repo: inbox/ is kept out of
// git, and only the extracted text is written, to dumps/file-<date>-<name>.md. A file already done (same content)
// is skipped. Prints one JSON line a file: {file, dump, words}, {file, read: true} for a PDF or image the
// interviewer reads itself, or {file, skipped: reason}. Never prints the text.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const TEXT = new Set(['.md', '.txt', '.csv', '.tsv', '.json', '.yaml', '.yml', '.eml', '.vtt', '.srt']);
const HTML = new Set(['.html', '.htm']);
const OFFICE = { '.docx': /^word\/(document|footnotes|comments)\.xml$/, '.pptx': /^ppt\/(slides\/slide|notesSlides\/notesSlide)\d+\.xml$/, '.xlsx': /^xl\/sharedStrings\.xml$/ };
const MAC = new Set(['.doc', '.rtf', '.odt', '.pages', '.webarchive']);
const SELF = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MEDIA = new Set(['.mp3', '.m4a', '.wav', '.mp4', '.mov', '.webm']);
const SECRET = /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abp]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})\b/g;

const xmlText = (x) => x.replace(/<\/(w:p|a:p|si|text:p)>/g, '\n').replace(/<[^>]+>/g, '')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The text of one file, or { read } / { skipped }. */
export function extract(file) {
  const ext = path.extname(file).toLowerCase();
  if (TEXT.has(ext)) return { text: fs.readFileSync(file, 'utf8') };
  if (HTML.has(ext)) return { text: fs.readFileSync(file, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, '').replace(/<[^>]+>/g, ' ') };
  if (OFFICE[ext]) {
    const names = execFileSync('unzip', ['-Z1', file], { encoding: 'utf8' }).split('\n').filter((n) => OFFICE[ext].test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (!names.length) return { skipped: 'no text found' };
    return { text: names.map((n) => xmlText(execFileSync('unzip', ['-p', file, n], { encoding: 'utf8', maxBuffer: 64 << 20 }))).join('\n\n') };
  }
  if (MAC.has(ext)) {
    try { return { text: execFileSync('textutil', ['-convert', 'txt', '-stdout', file], { encoding: 'utf8', maxBuffer: 64 << 20 }) }; } catch { return { skipped: 'save it as Word or PDF first' }; }
  }
  if (SELF.has(ext)) return { read: true };
  if (MEDIA.has(ext)) {
    // A local whisper, where installed, turns a recording into text; otherwise the call app's transcript is needed.
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'whisper-'));
      execFileSync(process.env.WHISPER_BIN || 'whisper', [file, '--output_format', 'txt', '--output_dir', tmp], { stdio: 'ignore', timeout: 3600000 });
      const txt = fs.readdirSync(tmp).find((n) => n.endsWith('.txt'));
      if (txt) return { text: fs.readFileSync(path.join(tmp, txt), 'utf8') };
    } catch {}
    return { skipped: 'a recording: send the transcript instead (Zoom, Teams, Google Meet, Otter or Voice Memos make one)' };
  }
  return { skipped: 'not a document' };
}

const walk = (p) => (fs.statSync(p).isDirectory()
  ? fs.readdirSync(p).filter((n) => !n.startsWith('.') && n !== 'done' && n !== 'README.md').flatMap((n) => walk(path.join(p, n)))
  : [p]);

export function files(repo, paths = []) {
  const inbox = path.join(repo, 'inbox');
  fs.mkdirSync(inbox, { recursive: true });
  // The originals stay on this computer only.
  const gi = path.join(repo, '.gitignore');
  const ignore = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
  if (!/^inbox\/$/m.test(ignore)) fs.writeFileSync(gi, ignore + (ignore && !ignore.endsWith('\n') ? '\n' : '') + 'inbox/\n');
  const dumps = path.join(repo, 'dumps');
  fs.mkdirSync(dumps, { recursive: true });
  const seenFile = path.join(dumps, 'files.json');
  const seen = fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : {};
  const today = new Date().toISOString().slice(0, 10);
  const out = [];
  for (const file of (paths.length ? paths : [inbox]).flatMap(walk)) {
    const name = path.basename(file);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex').slice(0, 16);
    if (seen[hash]) { out.push({ file: name, skipped: 'already done' }); continue; }
    let r;
    try { r = extract(file); } catch (e) { r = { skipped: `could not open it (${e.message.split('\n')[0]})` }; }
    if (r.skipped) { out.push({ file: name, skipped: r.skipped }); continue; }
    if (r.read) { out.push({ file: name, path: file, read: true }); seen[hash] = { file: name, at: today, read: true }; continue; }
    const text = r.text.replace(SECRET, '[removed]').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const words = (text.match(/\S+/g) || []).length;
    if (words < 5) { out.push({ file: name, skipped: 'no text found' }); continue; }
    const slug = name.replace(/\.[^.]+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'file';
    let dump = `file-${today}-${slug}.md`;
    for (let i = 2; fs.existsSync(path.join(dumps, dump)); i++) dump = `file-${today}-${slug}-${i}.md`;
    fs.writeFileSync(path.join(dumps, dump), `Source: ${name} (the expert's own file)\n\n${text}\n`);
    seen[hash] = { file: name, at: today, dump };
    out.push({ file: name, dump, words });
  }
  fs.writeFileSync(seenFile, JSON.stringify(seen, null, 2) + '\n');
  return out;
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  const [repo, ...paths] = process.argv.slice(2);
  if (!repo || !fs.existsSync(path.join(repo, 'expert.json'))) { console.error('Usage: files.mjs <expert-repo> [file or folder ...]'); process.exit(1); }
  for (const r of files(path.resolve(repo), paths.map((p) => path.resolve(p)))) console.log(JSON.stringify(r));
}
