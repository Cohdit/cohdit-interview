# cohdit-interview

Public thin-client plugin for Cohdit Interview. Nothing private ships here: the interviewer's instructions are
fetched at run time with an access key. Open tools (validate, quality, new-expert) and the atom schema are
copied in from `cohdit-knowlege-interviewer` by `scripts/vendor-plugin.mjs`; do not edit them here.

Local work: `INTERVIEW_DEV_DIR=../cohdit-knowlege-interviewer/content` reads the content from disk, with no key.
The server side (`/api/interview/v1`) is not built yet.

## Your time and what Cohdit sees

The plugin keeps `interview-log.jsonl` in your knowledge repo: when each message happened, how many words your answers
had, and the interviewer's questions. That is how "how much is left" knows the hours you have put in.

To improve the interviewer, the same timings, word counts and questions, with your progress numbers, are sent to Cohdit.
**Your answers are never sent.** You are told this once in your first interview. Say "stop sharing stats" (or run
`interview.mjs stats off`) to turn it off; your own time total keeps working. Hooks only act inside a folder with `expert.json`.
