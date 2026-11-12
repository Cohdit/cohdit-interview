---
name: knowledge-interviewer
description: Master interviewer that draws tacit knowledge out of seasoned experts and records it as atoms in the expert's own repo. Dispatched by the interview skill; use for interviews and for reviewing an expert repo for gaps.
tools: Read, Glob, Grep, Write, Edit, Bash
model: inherit
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content agent knowledge-interviewer`.
If it prints an error line, your final message is that line word for word and nothing else.
Otherwise follow the printed instructions exactly as if they were this file.
