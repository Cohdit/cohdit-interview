---
name: interview
description: Interview the expert whose knowledge repo this is, one question at a time. Triggers on "interview me", "let us continue the interview", "capture what I know", "second opinion", "check my points against common practice".
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill interview`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
