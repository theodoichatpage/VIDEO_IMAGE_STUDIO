# Aprilynne automatic review implementation

Goal: reuse existing Transcript rewrite transport and review/repair state machine. No manual start control.

1. Add regression tests proving completed rewritten sections automatically start review; script-applicable criteria passing automatically proceeds even when image/video criteria are not yet applicable. Preserve strict score/evidence validation and three automatic repair rounds.
2. Notify the always-mounted analysis controller when the project Transcript workspace changes. Persist a single queued run; wait for connection and competing jobs, resume without sending duplicates, retain Stop/Pause and manual repair controls.
3. Save each accepted draft/report checkpoint through the existing Studio API, using work epoch and update CAS. Only mark approved after validated applicable scores >=8, only hand off after acknowledged save. Manager pipeline stays in analysis until that approval is saved and handed off.
4. Browser integration fixture tests cover rewrite -> review -> repair -> review -> saved script -> split; disconnected/busy queue; maximum rounds; invalid result; stop; failed save; Manager completion gating. Run relevant unit/API regression tests and build. Deploy the branch matching the requested Aprilynne UI; do not overwrite the different production source.

Execution: native implementation in this session, as explicitly requested by the user. No additional approval gate.
