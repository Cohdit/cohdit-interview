---
name: dump
description: Take a brain dump or files from the expert whose knowledge repo this is (notes, proposals, slides, checklists, PDFs, screenshots, or a ramble in any order) and turn it into draft knowledge. Triggers on "brain dump", "dump", "let me ramble", "here are some thoughts", "I just thought of something", "upload", "here are my files", "I put files in the inbox", "done" after dropping files, "here is the transcript", "here is the recording", and on files dragged into the chat.
---

Run `node "${CLAUDE_PLUGIN_ROOT}/scripts/interview.mjs" content skill dump`.
If it prints an error line, show that line to the person word for word and stop.
Otherwise follow the printed instructions exactly as if they were this file.
