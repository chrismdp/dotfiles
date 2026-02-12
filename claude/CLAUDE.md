# Global Claude Instructions

## Communication Style

- **When user hints at a location or source, dig deeper**: If user says "check X" or "it's in Y", persist in finding it rather than saying it doesn't exist. User expects resourcefulness.
- **Exhaust search strategies before declaring "not found"**: Try at least 5 different approaches (different keywords, sender domains, date ranges, `has:attachment`, amount-based, broad terms) before saying something doesn't exist. User expects thorough searching.
- **Concise requests expect full execution**: Short directives like "pull X from Y" mean figure out the how - don't ask for clarification unless genuinely stuck.
- **Consolidate related information**: When preparing for meetings/calls, synthesize research into a single structured document with clear headers rather than spreading across multiple responses.
- **Prefer stateless over stateful solutions**: When building automation, use existing state (e.g., git diff between commits) rather than introducing new tracking files. Simpler is better.

## Content Accuracy

- **When replacing references, check the source**: If content references something from another document (e.g. "recap from Session 1"), always read the source document to verify what was actually covered. Don't invent replacements based on what sounds right — check what's real.

## Content Creation

**CRITICAL**: When producing ANY content (blog posts, LinkedIn posts, newsletters, emails, proposals, webinar copy), ALWAYS load the writing-style skill first using `/writing-style`. This applies even for short pieces. AI-generated content always contains slop patterns that need the style guide to avoid.

## Learning from Corrections

- **When corrected, persist immediately**: If user corrects your approach, disagrees with a choice, or says "remember this", write the lesson to the appropriate file before continuing. Pick the right target: skill SKILL.md for skill-specific lessons, project CLAUDE.md for project patterns, global CLAUDE.md for universal preferences. Only capture the reusable pattern, not the specific situation. Don't ask — just do it and briefly mention what you wrote.

## Web Fetching

- **Perplexity MCP as fallback**: When WebFetch returns a 403 or other access error, retry using the Perplexity MCP tools (`perplexity_ask` or `perplexity_search`) to fetch and synthesise the content. Perplexity can access pages that block direct fetching.

## Email Safety

**NEVER send emails directly** using `gog gmail send`. Always create drafts with `gog gmail drafts create` for user review. Only use `gog gmail send` if the user explicitly says "send it now". When drafting reply emails, use `--reply-to-message-id` to thread into existing conversations and always include `--to` with the recipient address (the reply-to flag only sets threading headers, it does not auto-populate recipients).
