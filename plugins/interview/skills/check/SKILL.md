---
name: check
description: Check an expert repo: validates every piece of knowledge and reports coverage and gaps. Triggers on "check my knowledge", "how complete is it", "what is missing".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill check`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
