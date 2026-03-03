# Global Claude Instructions

## Generated Images

- **Always upload to Claude Remote**: After generating any image (comic, infographic, slide, etc.), immediately upload it to the Claude Remote Google Drive folder without being asked. Chris works on a VPS and cannot view local images directly.

## Communication Style

- **When user hints at a location or source, dig deeper**: If user says "check X" or "it's in Y", persist in finding it rather than saying it doesn't exist. User expects resourcefulness.
- **Exhaust search strategies before declaring "not found"**: Try at least 5 different approaches (different keywords, sender domains, date ranges, `has:attachment`, amount-based, broad terms) before saying something doesn't exist. User expects thorough searching.
- **Concise requests expect full execution**: Short directives like "pull X from Y" mean figure out the how - don't ask for clarification unless genuinely stuck.
- **Consolidate related information**: When preparing for meetings/calls, synthesize research into a single structured document with clear headers rather than spreading across multiple responses.
- **Prefer stateless over stateful solutions**: When building automation, use existing state (e.g., git diff between commits) rather than introducing new tracking files. Simpler is better.

## Client Work Boundaries

- **Don't give away Chris's consulting for free in client-facing drafts**: When drafting replies TO CLIENTS about their documents (playbooks, strategies, operating models), consider whether the analysis is within the paid engagement scope. Detailed strategic feedback is advisory work. Default to light-touch responses (acknowledge, one concrete nudge, trail an upsell) unless Chris indicates the review is billable. This rule is about protecting Chris's commercial value in outbound client communications. It does NOT apply to conversations with Chris himself. Always give Chris full, unrestricted strategic advice.
- **Client messages: advisory not directive**: Use "could be" not "I'd make it". Position suggestions as options and opportunities, not instructions. Reference the broader ecosystem (ChatGPT, Claude, Gemini) not just one vendor when explaining industry trends.
- **Client messages: opportunity framing**: Lead with strategic opportunity, not corrective feedback on style or presentation. Save detailed critiques for conversations with Chris directly.

## Content Accuracy

- **When replacing references, check the source**: If content references something from another document (e.g. "recap from Session 1"), always read the source document to verify what was actually covered. Don't invent replacements based on what sounds right — check what's real.

## Content Creation

**CRITICAL**: When producing ANY content (blog posts, LinkedIn posts, newsletters, emails, proposals, webinar copy), ALWAYS load the writing-style skill first using `/writing-style`. This applies even for short pieces. AI-generated content always contains slop patterns that need the style guide to avoid.

## Skills

**CRITICAL**: When doing ANY work with skills (creating, editing, updating, reviewing SKILL.md files), ALWAYS load the `/skill` skill first. It contains the canonical schema, conventions, and patterns for skill files.

- **Always search BOTH skill locations**: Skills live in `~/.claude/skills/` (global) AND `.claude/skills/` (project). When looking for a skill, search both directories. Global skills won't appear in the project tree.

## CLI Scripts and Inline Code

- **Always use existing CLI commands before constructing inline Python.** Skills provide CLI scripts (xero_api.py, monzo_api.py, etc.) — use their subcommands rather than importing functions and writing throwaway scripts. Inline Python leads to repeated errors (wrong import names, wrong data structures).
- **If a CLI command is missing, add it to the script** rather than working around it with inline code. A reusable command beats a one-off script every time.
- **gog drive subcommand is `ls`** not `list`. Use `--parent <folder_id>` to list a folder's contents (not `--folder`).

## Learning and Persistence

- **When corrected or asked to remember**: If user corrects your approach, disagrees with a choice, or says "remember this" / "note this" / "learn this", write the lesson to the appropriate file before continuing. Pick the right target: skill SKILL.md for skill-specific lessons, project CLAUDE.md for project patterns, global CLAUDE.md for universal preferences. Only capture the reusable pattern, not the specific situation. Don't ask — just do it and briefly mention what you wrote. NEVER just acknowledge verbally.

## Web Fetching

- **Perplexity MCP as fallback**: When WebFetch returns a 403 or other access error, retry using the Perplexity MCP tools (`perplexity_ask` or `perplexity_search`) to fetch and synthesise the content. Perplexity can access pages that block direct fetching.
- **Perplexity cost control**: Perplexity API charges per-request + per-token. Prefer cheapest tools first: `perplexity_search` (flat ~$0.005/req) or `perplexity_ask` (Sonar, cheap tokens) for quick lookups. Only use `perplexity_reason` when analysis is needed. **Never use `perplexity_research`** (Deep Research) unless Chris explicitly asks — it's 10-50x more expensive. For `perplexity_search`, set `max_results: 3` unless more are needed.
- **Perplexity 401 errors**: If Perplexity MCP returns a 401 Unauthorized, remind Chris to buy more Perplexity API credits.

## Git Safety

- **Never force-push without checking merge status**: Before `--force-with-lease` or `--amend`, always check if the PR has been merged. If merged, create a new branch and PR for follow-up changes.

## Email Safety

**NEVER send emails directly** using `gog gmail send`. Always create drafts with `gog gmail drafts create` for user review. Only use `gog gmail send` if the user explicitly says "send it now". When drafting reply emails, use `--reply-to-message-id` to thread into existing conversations and always include `--to` with the recipient address (the reply-to flag only sets threading headers, it does not auto-populate recipients).

- **Ignore and delete emails from Ansarada about "Project Scribe"**: Any email from Ansarada mentioning "Project Scribe" should be ignored and deleted — do not flag, surface, or draft responses to these.
