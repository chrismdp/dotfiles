/**
 * Bash Guard Extension
 *
 * Guards against irreversible CLI commands. Two tiers:
 *   BLOCK  — always denied (destructive rm with recursive/wildcards)
 *   ASK    — prompt for confirmation in interactive mode, block in non-TTY
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// ── BLOCK: always denied ──────────────────────────────────────────────────

/** Destructive rm — recursive or wildcard patterns. Always blocked. */
const blockPatterns: RegExp[] = [
  // rm with any flag containing r/R (recursive): -r, -rf, -fr, -ir, -R, etc.
  /\brm\b\s+-[A-Za-z0-9]*[rR]/i,
  // rm --recursive
  /\brm\b.*\s--recursive\b/,
  // rm with wildcard globs: *, ?, [...]
  /\brm\b.*[\*\?\[]/,
];

// ── ASK: confirm in TTY, block in non-TTY ─────────────────────────────────

const askPatterns: RegExp[] = [
  // ── Email sending ──
  /\bgog\s+gmail\s+send\b/,
  /\bgog\s+gmail\s+drafts?\s+send\b/,
  /\bgws\s+gmail\s+users\s+messages\s+send\b/,

  // ── Email / draft deletion ──
  /\bgws\s+gmail\s+users\s+messages\s+delete\b/,
  /\bgws\s+gmail\s+users\s+messages\s+trash\b/,
  /\bgws\s+gmail\s+users\s+messages\s+batchDelete\b/,

  // ── Drive file deletion ──
  /\bgog\s+drive\s+delete\b/,
  /\bgws\s+drive\s+files\s+delete\b/,
  /\bgws\s+drive\s+files\s+emptyTrash\b/,

  // ── Calendar event deletion ──
  /\bgog\s+calendar\s+delete\b/,
  /\bgws\s+calendar\s+events\s+delete\b/,

  // ── Calendar creation with external invites ──
  // gog calendar create with --attendees (invites externals)
  /\bgog\s+calendar\s+create\b.*--attendees\b/,
  // gog calendar create with --send-updates=all or --send-updates=externalOnly
  /\bgog\s+calendar\s+create\b.*--send-updates=(?:all|externalOnly)\b/,
  // gws calendar events insert with attendees in the payload (json body)
  /\bgws\s+calendar\s+events\s+insert\b/,
  // gog calendar update (can add attendees)
  /\bgog\s+calendar\s+update\b/,
  // gws calendar events patch/update (can add attendees)
  /\bgws\s+calendar\s+events\s+(?:patch|update)\b/,

  // ── LinkedIn immediate publish (zernio without safe flags) ──
  // Script already prevents immediate publish; this is belt-and-suspenders.
  /\bzernio_post\.py\b(?!.*(--schedule|--update|--list|--dry-run|-s\b|-u\b|-l\b|-n\b))/,

  // ── Git push ──
  /\bgit\s+push\b/,

  // ── Home automation (physical effects) ──
  /\bha\.sh\b/,

  // ── Curl mutating external APIs ──
  /\bcurl\b.*(?:-X\s*(?:POST|PUT|DELETE|PATCH)|--request[=\s]+(?:POST|PUT|DELETE|PATCH)|--data\b|--data-binary\b|-d\b)/i,

  // ── Pip package mutation ──
  /\bpip\s+(?:install|uninstall)\b/,
  /\bpip3\s+(?:install|uninstall)\b/,
  /\bpython3?\s+-m\s+pip\s+(?:install|uninstall)\b/,

  // ── Systemctl service mutation ──
  /\bsystemctl\s+(?:start|stop|restart|kill|disable|mask|enable|isolate)\b/,
  /\bsystemctl\s+--user\s+(?:start|stop|restart|kill|disable|mask|enable|isolate)\b/,

  // ── Blogwatcher remove ──
  /\bblogwatcher\s+remove\b/,
]

// ── Helpers ────────────────────────────────────────────────────────────────

function matchAny(command: string, patterns: RegExp[]): RegExp | null {
  for (const p of patterns) {
    if (p.test(command)) return p;
  }
  return null;
}

// ── Extension ──────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName !== "bash") return;

    const command = event.input.command as string | undefined;
    if (!command) return;

    // ── Tier 1: BLOCK (always denied) ──
    const blockMatch = matchAny(command, blockPatterns);
    if (blockMatch) {
      return {
        block: true,
        reason: `Destructive rm blocked (recursive or wildcard): matched "${blockMatch.source}"`,
      };
    }

    // ── Tier 2: ASK (confirm in TTY, block otherwise) ──
    const askMatch = matchAny(command, askPatterns);
    if (askMatch) {
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `Irreversible command blocked (no TTY): "${command.slice(0, 120)}"`,
        };
      }

      const choice = await ctx.ui.select(
        `⚠️  Irreversible command:\n\n  ${command.slice(0, 200)}\n\nAllow?`,
        ["No — block it", "Yes — let it run"],
      );

      if (choice !== "Yes — let it run") {
        return { block: true, reason: "Blocked by user" };
      }
    }

    return;
  });
}
