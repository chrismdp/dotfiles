# Global Claude Instructions

## Output Files

- **Review Board for review, Claude Remote for archiving**: When generating output that needs Chris's review (images, drafts, content), use the Review Board (`review.images` in project YAML) as the primary review surface — not Claude Remote. Still upload to Claude Remote for archiving/sharing, but the Review Board is how Chris sees and acts on things. Never save only to `tmp/`.
- **Vault notes are archives, not delivery**: Chris does not read vault notes regularly. When a skill produces a summary, reflection, or conclusion Chris should see, present it directly: inline if interactive, Telegram if not. Writing to a vault note alone is archiving, not delivery. The actual read surfaces are the Review Board, Telegram, and the conversation itself.

## Credential Safety

- **Never ask for passwords directly.** When iCloud, Apple, or other credential-dependent operations are needed, write a script the user runs interactively in their own terminal. Passwords must never pass through the conversation.

## Communication Style

- **When user hints at a location or source, dig deeper**: If user says "check X" or "it's in Y", persist in finding it rather than saying it doesn't exist. User expects resourcefulness.
- **Exhaust search strategies before declaring "not found"**: Try at least 5 different approaches (different keywords, sender domains, date ranges, `has:attachment`, amount-based, broad terms) before saying something doesn't exist. User expects thorough searching.
- **Concise requests expect full execution**: Short directives like "pull X from Y" mean figure out the how - don't ask for clarification unless genuinely stuck.
- **Consolidate related information**: When preparing for meetings/calls, synthesize research into a single structured document with clear headers rather than spreading across multiple responses.
- **Prefer stateless over stateful solutions**: When building automation, use existing state (e.g., git diff between commits) rather than introducing new tracking files. Simpler is better.
- **Batch multiple instructions into one pass**: When Chris gives several changes in a single message, apply all of them in one edit rather than making sequential round-trips. "Crack on" means do everything now, do not wait for confirmation between steps.

## Client Work Boundaries

- **Don't give away Chris's consulting for free in client-facing drafts**: When drafting replies TO CLIENTS about their documents (playbooks, strategies, operating models), consider whether the analysis is within the paid engagement scope. Detailed strategic feedback is advisory work. Default to light-touch responses (acknowledge, one concrete nudge, trail an upsell) unless Chris indicates the review is billable. This rule is about protecting Chris's commercial value in outbound client communications. It does NOT apply to conversations with Chris himself. Always give Chris full, unrestricted strategic advice.
- **Client messages: advisory not directive**: Use "could be" not "I'd make it". Position suggestions as options and opportunities, not instructions. Reference the broader ecosystem (ChatGPT, Claude, Gemini) not just one vendor when explaining industry trends.
- **Client messages: opportunity framing**: Lead with strategic opportunity, not corrective feedback on style or presentation. Save detailed critiques for conversations with Chris directly.
- **Don't invent offerings from engagement components**: A module delivered within a bespoke consulting engagement is not a standalone product. Do not promote parts of past engagements into new course/product ideas unless the user explicitly frames them as one.
- **Senior audiences: frame as adding capability, not closing a gap**: Training and product names for execs and boards must not imply the buyer is behind, missing out, or needs catching up. "Unlock" implies locked. "Rethink" implies wrong. Frame as adding capability.

## Content Safety

- **Never include client names or identifiable data in public content** (blog posts, LinkedIn posts, newsletters). Anonymise all references ("inbound sales lead", "training enquiry"). Only name clients if Chris has a published case study for them. Link to `/training` page instead.
- **Never invent questions, anecdotes, or audience reactions** for content. Research real data (Perplexity, vault, transcripts) or ask Chris what actually comes up. If evidence is not available, say so rather than fabricating.
- **Verify vault numbers before citing them**: When citing specific numbers (decision log lines, email counts, etc.), always count the actual files. Never reuse numbers from previous drafts or decision trails without re-checking.

## Content Accuracy

- **When replacing references, check the source**: If content references something from another document (e.g. "recap from Session 1"), always read the source document to verify what was actually covered. Don't invent replacements based on what sounds right — check what's real.

## Content Creation

**CRITICAL**: When producing ANY content (blog posts, LinkedIn posts, newsletters, emails, proposals, webinar copy), ALWAYS load the writing-style skill first using `/writing-style`. This applies even for short pieces. AI-generated content always contains slop patterns that need the style guide to avoid.

## Skills

**CRITICAL**: When doing ANY work with skills (creating, editing, updating, reviewing SKILL.md files), ALWAYS load the `/skill` skill first. It contains the canonical schema, conventions, and patterns for skill files.

- **Always search BOTH skill locations**: Skills live in `~/.claude/skills/` (global) AND `.claude/skills/` (project). When looking for a skill, search both directories. Global skills won't appear in the project tree.
- **Investigate before workaround**: When a sub-agent produces poor output, check whether it had the right context (loaded skills, clear instructions) before proposing alternative workflows or reclassifying tasks.

## CLI Scripts and Inline Code

- **Always use existing CLI commands before constructing inline Python.** Skills provide CLI scripts (xero_api.py, monzo_api.py, etc.) — use their subcommands rather than importing functions and writing throwaway scripts. Inline Python leads to repeated errors (wrong import names, wrong data structures).
- **If a CLI command is missing, add it to the script** rather than working around it with inline code. A reusable command beats a one-off script every time.
- **gog drive subcommand is `ls`** not `list`. Use `--parent <folder_id>` to list a folder's contents (not `--folder`).
- **gog drive move** uses `--parent <folder_id>` not `--to`
- **gog drive rm** requires `--force` in non-interactive/scripted contexts
- **gog slides list-slides** doesn't support `--json`. Use `-p` (plain/TSV) for parseable output.
- **gog drive get** shows metadata only — it does NOT download file content. For binary file downloads, use `gws drive files get --params '{"fileId": "ID", "alt": "media"}'`. The actual file is saved as `download.pdf` (or similar) in cwd; the JSON response contains a `saved_file` key with the filename.
- **gog gmail batch modify** takes space-separated message IDs as positional args, not comma-separated.
- **gog gmail thread get `<threadId>`** to read a full email thread. Not `messages get` or bare `get`.
- **gog gmail drafts list** returns empty once drafts are sent/deleted. To find what was actually sent, search sent mail: `gog gmail search "to:<recipient>"`.
- **gog calendar events `--to`** only accepts explicit dates (YYYY-MM-DD) or keywords (today, tomorrow, monday). Relative expressions like "+2 days" or "+1d" are not supported.

## Personal Scheduling Rules

- **Max two evenings out per week** (one work, one personal). Check this when evaluating event invitations that involve an evening commitment.
- **Default to afternoon meetings** (2pm-4:30pm). Chris vastly prefers afternoons. Never suggest morning slots unless afternoon is impossible.

## Learning and Persistence

- **Never use project-based auto memory** (`~/.claude/projects/*/memory/`). Chris runs Claude across multiple machines so project memory doesn't sync. Store all persistent memories in the vault itself (concept notes, CLAUDE.md files, or skill files).
- **System rules go in skills/CLAUDE.md, not memory**: Rules about how the project system, agent loops, or workflows operate belong in the relevant skill file or CLAUDE.md. Auto-memory is for user context, approach feedback, and external references — not for system architecture or routing logic.
- **When corrected or asked to remember**: If user corrects your approach, disagrees with a choice, or says "remember this" / "note this" / "learn this", write the lesson to the appropriate file before continuing. Pick the right target: skill SKILL.md for skill-specific lessons, project CLAUDE.md for project patterns, global CLAUDE.md for universal preferences. Only capture the reusable pattern, not the specific situation. Don't ask — just do it and briefly mention what you wrote. NEVER just acknowledge verbally.
- **Verify bulk operations by reading results**: After bulk file changes (sed, Python replace, migrations), always read a sample file's actual content to confirm the change took effect. Don't trust command output or exit codes alone — read the file.
- **YAML frontmatter: parse, don't string-replace**: When modifying YAML frontmatter in bulk, split on `---` delimiters and only modify the frontmatter section. Never use whole-file string replace — body text often contains the same strings as frontmatter and will get corrupted.

## Web Fetching

- **Perplexity MCP as fallback**: When WebFetch returns a 403 or other access error, retry using the Perplexity MCP tools (`perplexity_ask` or `perplexity_search`) to fetch and synthesise the content. Perplexity can access pages that block direct fetching.
- **Perplexity cost control**: Perplexity API charges per-request + per-token. Prefer cheapest tools first: `perplexity_search` (flat ~$0.005/req) or `perplexity_ask` (Sonar, cheap tokens) for quick lookups. Only use `perplexity_reason` when analysis is needed. **Never use `perplexity_research`** (Deep Research) unless Chris explicitly asks — it's 10-50x more expensive. For `perplexity_search`, set `max_results: 3` unless more are needed.
- **Perplexity 401 errors**: If Perplexity MCP returns a 401 Unauthorized, remind Chris to buy more Perplexity API credits.

## 1Password CLI (op)

- **Always pass `--vault Kim`**: The `op` CLI on this VPS runs as a service account which requires an explicit vault. List vaults with `op vault list` if unsure. Never omit `--vault`.

## Claude CLI

- **No `--cwd` flag**: `claude` CLI does not support `--cwd`. To set working directory, `cd` before invoking `claude`.
- **Never spawn `claude` CLI from inside a running Claude Code session**: It will error with "cannot be launched inside another Claude Code session". Test cron-invoked skills from a separate terminal.

## Git Safety

- **Never force-push without checking merge status**: Before `--force-with-lease` or `--amend`, always check if the PR has been merged. If merged, create a new branch and PR for follow-up changes.

## Email Safety

**NEVER send emails directly** using `gog gmail send`. Always create drafts with `gog gmail drafts create` for user review. Only use `gog gmail send` if the user explicitly says "send it now". When drafting reply emails, use `--reply-to-message-id` to thread into existing conversations and always include `--to` with the recipient address (the reply-to flag only sets threading headers, it does not auto-populate recipients).

- **Ignore and delete emails from Ansarada about "Project Scribe"**: Any email from Ansarada mentioning "Project Scribe" should be ignored and deleted — do not flag, surface, or draft responses to these.
- **Amazon delivery notifications: skip unless alcohol**: Do not send Telegram alerts for Amazon delivery emails (out for delivery, delivered, dispatched) unless the item description suggests it contains alcohol. All other Amazon deliveries should be ignored silently.
