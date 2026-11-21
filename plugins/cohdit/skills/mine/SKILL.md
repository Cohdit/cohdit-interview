---
name: mine
description: Capture the expert's knowledge from what they have already said in past work sessions on this computer, with no questions. Triggers on "mine my sessions", "use what I've already said", "learn from my past work", "extract from my chats".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill mine`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
