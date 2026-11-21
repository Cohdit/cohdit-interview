---
name: calibrate
description: Optional extra check: the agent drafts test questions and answers, the expert scores them 1 to 5. Triggers on "calibrate", "score the answers", "rate the answers".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill calibrate`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
