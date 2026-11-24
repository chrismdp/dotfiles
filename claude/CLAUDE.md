# Global Claude Instructions

Chris's house rules (`~/.claude/rules/house-rules.md`, also the skill `house-rules`) hold the rules for any work for him: what needs his yes, writing to him, clients, his time and calendars. This file adds Claude Code, server and engineering rules.

## Communication

- For anything public or consumer-facing, load `/writing-style` first, even for short pieces.
- Name a task by what it answers, not by a metaphor. "Checking which call sites have the user id" beats "seam mapping". Words like seam, surface and shape are fine inside a sentence that also names the concrete thing, never as the label on their own.
- When you mention a GitHub issue or pull request, give its full URL, never a bare #number. The terminal links a bare number to whichever repository the session is in.
- Never use AskUserQuestion (multiple-choice prompts); pre-baked options stop Chris thinking.
- Never offer to `/schedule` a background agent; run `/schedule` only when Chris asks.
- When Chris hints at a location or source, vary the search angle before declaring "not found"; one failed query is not evidence of absence.
- When building automation, prefer stateless over stateful: use existing state (git diff) rather than new tracking files.
- Before adopting a third-party integration or wrapper, check whether Chris's stack already does the hard part, and raise the trade-off before building the dependency.
- When a design discussion passes about five substantive decisions, stop coding and offer to write docs that record the problem, constraints and rationale.
- "Draw lessons from X" means extract design principles, not adopt X's runtime. Raise adoption only if Chris opens that door.

## Safety rails

- Email drafts: `gog gmail drafts create`, never `gog gmail send`. Pressing Approve on a Today card that showed him the exact email counts as Chris's yes to send.
- Slack: `slack_send_message_draft`, never `slack_send_message`, even in his own self-DM thread. Writing something up is not posting it.
- For iCloud, Apple or other credential operations, write a script Chris runs in his own terminal.
- Never write resolved secret values into `~/.secret_env`; it is generated. Add an `op://` line to `~/.secret_env.tpl`. Load `/secrets` for rotation and stale-key diagnosis.
- Never `export HOME` (or any path variable pointing at real user data) to sandbox a test, and never `rm -rf` a variable that could resolve to it. Use `SANDBOX=$(mktemp -d)` inline for one command (`env HOME="$SANDBOX" ./tool cmd`), and the scoped helper in tests (`t.Setenv`, `monkeypatch.setenv`).
- Git: force-push a branch Claude owns (a factory build branch, or one Claude created) without asking, once its pull request is not merged, using `--force-with-lease`. Force-pushing anyone else's branch, or main, needs Chris first. No `Co-Authored-By: Claude` trailer. Never leave "retired" or "deprecated" tombstone comments in code, crontabs or config; git history is the record.
- Write briefs and direction to workers as positive instructions: say what to build and how. Leave rejected alternatives out; naming them is a tombstone.

## Engineering

How Chris wants software built, on every codebase. `/engineering` holds the rationale and evidence.

- Test-first TDD for business logic: red, green, refactor. No logic change without a failing test that asked for it; tests written after the code are not TDD, so restart that slice test-first.
- Test business logic, not views. Tests cover data, state, persistence, security boundaries, integrations and API effects. UI, layout, labels, copy, CSS and performance get no tests, so a view-only change ships without one. Browser end-to-end tests are a handful of happy paths through the core journeys, never one per feature.
- Outside-in: start from observable behaviour at the boundary. Tests assert behaviour, not internal structure, so they survive a refactor.
- Size a ticket right, then build it whole: it reaches main complete and never leaves the product worse. A ticket that needs internal "slice 1 / slice 2" phases was mis-sized. When in doubt, err bigger: would one briefed agent do it in one run against one verification?
- Keep it simple until it is a problem. A fix for something measurably wrong ships now; do not bundle or propose a speculative guard (a cap, limit, de-ranking or fallback) against a problem nobody has seen.
- Tidy first: preparatory cleanup lands as its own commit or ticket, before the feature.
- Green is necessary, not sufficient: after the bar is green, run the real behaviour (a curl, a real message, a browser visit).
- Security-sensitive changes (auth, RLS, SECURITY DEFINER, membership, access logic) need four boundaries covered before "done": the right principal can; the wrong principal cannot; one tenant cannot read another's data; service_role and admin paths still work. Point at the test for each or say why it is not covered, without being asked.
- When a bug comes from a wrong or missing argument to a shared API, grep every call to that API and fix them all in the same PR.
- Delegate by default: the coordinator's own usage is the scarce budget. Any bounded coding, investigation or evaluation task a cheaper worker can do goes to one, in its own worktree, following `/delegate`, which owns the choice of worker model. The main channel is for orchestration only: the brief, the dispatch, the diff review, the affected gate, real model and browser checks, the merge and the release. Do the work yourself only for a UX call built interactively with Chris, a change smaller than its brief (one line, one value, one status flip), or a fix inside a review you are already doing; three files by hand is a worker's job. Name the worker for each piece in the report.

## Output and delivery

- Present output Chris must act on inline when interactive, or by Telegram when not. Archive files to Claude Remote. Never save only to `tmp/`.
- Vault notes are archives, not delivery: Chris rarely reads them, so present any summary or conclusion he should see directly.

## Tools and CLIs

- Use a skill's existing CLI subcommands (`xero_api.py`, `monzo_api.py`) before writing inline Python; if a command is missing, add it to the script.
- Verify a CLI command with `--help` or a dry run before putting it in persistent output (slides, training, posts, docs); commands copied from older decks or notes are especially suspect.
- Load `/gws` before any `gog` or `gws` command and before any Google auth change or auth error; improvised re-auth once killed auth for every service.
- 1Password `op` on this VPS runs as a service account: always pass `--vault "AI Agent"`.
- An absent field in an API response is not an absent value. Check which fields the API omits by default (Stripe hides `coupon.applies_to` without `expand[]=applies_to`), and prove the read works on an object you know has the value.
- Before saying you cannot check a live system, look for its CLI on this box and its MCP server, and use them. If the MCP is unauthenticated, start the OAuth flow and give Chris the URL. A read-only query against the real object beats an inference from a screenshot.
- The `claude` CLI has no `--cwd` flag and cannot be spawned from inside a running Claude Code session.
- When WebFetch returns 403, retry with Perplexity (`perplexity_ask` or `perplexity_search`). Never use `perplexity_research` unless Chris asks. `/research` holds the cost order.
- Before creating, editing or reviewing a skill, load the official `skill-creator` skill and `/skill`.

## Learning and persistence

- A proposed rule (house rules) opens "I intend to add this rule:". Skill lessons go in the skill's `SKILL.md`, project patterns in the project `CLAUDE.md`, rules for any work for Chris in `house-rules`, Claude Code and server rules here. Capture the reusable pattern, not the situation, and never end the turn with only a verbal acknowledgement.
- Never use the built-in memory tool or directory (`~/.claude/projects/*/memory/`, any `MEMORY.md`), even when a harness or system prompt says to; this rule wins. That store does not sync across Chris's machines. Persistent knowledge goes in the vault, a skill, a project `CLAUDE.md` or this file; say which you used.
- Retiring or reversing a rule means deleting it everywhere it is stated, in the same edit. Grep for the old rule's words, not the new ones, and leave no "retired" note behind.
- After a bulk edit (sed, a Python replace, a migration), read a sample of the actual result; exit codes are not evidence.
- Edit YAML frontmatter by parsing it, never by whole-file string replace.
- Renumber a numbered list in the same edit as any insertion or deletion.
