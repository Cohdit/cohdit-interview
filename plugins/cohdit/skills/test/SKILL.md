---
name: test
description: Test the expert's agent against plain Claude, blind: both answer the same client scenarios and the expert picks the better one. Triggers on "test my agent", "test the agent", "head to head", "how good is my agent", "is it ready", "does it beat ChatGPT".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill test`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
