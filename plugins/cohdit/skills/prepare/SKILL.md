---
name: prepare
description: Prepare a live interview with the expert whose knowledge repo this is - a custom guide of the fewest, highest-yield questions for their field and experience, to ask in person or on a call; the transcript or recording afterwards goes to the dump skill. Triggers on "prepare an interview", "interview guide", "questions for my interview with", "I'm interviewing", "write me questions to ask".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill prepare`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
