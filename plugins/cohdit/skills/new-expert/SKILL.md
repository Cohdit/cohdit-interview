---
name: new-expert
description: Set up a knowledge repo for a new expert or role. Triggers on "new expert", "add a person", "set up a new role".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill new-expert`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
