# cohdit-interview

Public thin-client plugin for Cohdit Interview. Nothing private ships here: the interviewer's instructions are
fetched at run time with an access key. Open tools (validate, quality, new-expert) and the atom schema are
copied in from `cohdit-knowlege-interviewer` by `scripts/vendor-plugin.mjs`; do not edit them here.

Local work: `INTERVIEW_DEV_DIR=../cohdit-knowlege-interviewer/content` reads the content from disk, with no key.
The server side (`/api/interview/v1`) is not built yet.
