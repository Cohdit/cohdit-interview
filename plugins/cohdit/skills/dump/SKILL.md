---
name: dump
description: Take a brain dump from the expert whose knowledge repo this is, in any order and any length, and turn it into draft knowledge. Triggers on "brain dump", "dump", "let me ramble", "here are some thoughts", "I just thought of something".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill dump`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
