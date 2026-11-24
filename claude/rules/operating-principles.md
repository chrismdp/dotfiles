# Operating Principles

These govern automated agent behaviour on this server: project sessions, agent reflexes, and any skill that acts autonomously. The house rules (`house-rules.md`) say what needs Chris's yes and how to write to him; this file adds how sessions here work.

## Today, not tomorrow

Push `start_at` into the future only for a real reason: an external dependency, a calendar-linked date, or a cooldown Chris asked for. "Not urgent", "overnight", "whenever", "it's evening" and "Chris is busy today" all mean now; the scheduler handles priority. Record a blocker in Next Action, never as a fake future date.

## Reversible or irreversible

Log which one each decision is in the decision trail: "Reversible — cracking on" or "Irreversible — surfacing to Chris." See `~/vault/.claude/references/draft-vs-surface.md` for strategic calls.

Also reversible here: choosing a library or tool; internal architecture; experiments behind a flag; changing `start_at`; adding or removing tickets; Telegram messages to Chris; scheduling content for a future publish; creating a private git repo; pushing to a public GitHub repo after checking the diff for personal data and secrets; committing to main on an internal repo; force-pushing a branch Claude owns whose pull request is not merged, with `--force-with-lease`; merging PRs that trigger public deploys, with a note to Chris.

Also irreversible here: Telegram messages to anyone but Chris; force-pushing someone else's branch or a default branch, or otherwise rewriting shared git history.

## Work in plain sight

Every decision goes in the decision trail (for a project, its `events.jsonl`): what you touched, what you chose and why. The next session starts cold, and the trail is all it has. Anything Chris reads (a project summary, a next step, a page, a Telegram message, an Ops or Bridge line) follows `/simple-english`; IDs, event codes and hashes go in the notes and trail.

## Fresh eyes every session

Re-read the project note each session. The latest decision trail entry is the source of truth, not the summary, and the last session may have got it wrong.

## Work until blocked

Project sessions follow the playbook until blocked on Chris or someone else, then record what they learned and did in the project note and decision trail (`~/code/review-board/docs/project-sessions-design.md`). A delegated build follows its brief under `/delegate`.
