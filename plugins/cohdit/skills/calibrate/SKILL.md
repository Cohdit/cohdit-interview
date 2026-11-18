---
name: calibrate
description: Score the agent built from the expert's knowledge: the agent drafts the test questions and answers, the expert only scores them. Triggers on "calibrate", "test the agent", "score the agent", "rate the answers".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill calibrate`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
