/**
 * Bash Guard Extension
 *
 * Guards against irreversible CLI commands. Two tiers:
 *   BLOCK  — always denied (destructive rm with recursive/wildcards)
 *   ASK    — prompt for confirmation in interactive mode, block in non-TTY
 *
 * Calendar event deletion is attendee-aware: events with only Chris on them
 * may be deleted freely; events with anyone else on the attendee list are
 * always blocked; unparseable/unfetchable cases fall back to ASK.
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

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

// ── Calendar event deletion: attendee-aware ───────────────────────────────
//
// Solo events (no attendees, or every attendee is Chris himself) may be
// deleted without prompting. Events with anyone else on the attendee list
// are BLOCKED outright — the agent must never delete those; surface to Chris.
// Commands we can't parse, or events we can't fetch, fall back to the ASK
// tier (confirm in TTY, block headless).

const OWN_EMAILS = new Set(["chris.p@rsons.org", "cp@cherrypick.co"]);

const CAL_DELETE_RE =
  /\bgog\s+(?:calendar|cal)\s+(?:delete|rm|del|remove)\b|\bgws\s+calendar\s+events\s+delete\b/;

interface CalDeleteTarget {
  calendarId: string;
  eventId: string;
}

/**
 * Extract (calendarId, eventId) for every calendar-delete in the command.
 * Returns null when any delete can't be parsed (variables, odd flag order,
 * more than one gws delete) — callers must then fall back to ASK.
 */
export function extractCalDeleteTargets(command: string): CalDeleteTarget[] | null {
  const verbs = command.match(new RegExp(CAL_DELETE_RE.source, "g")) ?? [];
  if (verbs.length === 0) return [];

  const targets: CalDeleteTarget[] = [];

  // gog calendar delete [flags] <calendarId> <eventId> — skip --flag / --flag=value
  // tokens; a flag with a separate value (-a foo) misparses, fetch then fails,
  // and we fall back to ASK, which is the safe direction.
  const gogArgs =
    /\bgog\s+(?:calendar|cal)\s+(?:delete|rm|del|remove)\s+(?:--?[\w-]+(?:=\S+)?\s+)*([^-\s]\S*)\s+([^-\s]\S*)/g;
  for (const m of command.matchAll(gogArgs)) {
    targets.push({ calendarId: m[1], eventId: m[2] });
  }

  // gws calendar events delete --params '{"calendarId": "...", "eventId": "..."}'
  const gwsCount = (command.match(/\bgws\s+calendar\s+events\s+delete\b/g) ?? []).length;
  if (gwsCount === 1) {
    const cal = command.match(/"calendarId"\s*:\s*"([^"]+)"/);
    const ev = command.match(/"eventId"\s*:\s*"([^"]+)"/);
    if (cal && ev) targets.push({ calendarId: cal[1], eventId: ev[1] });
  } else if (gwsCount > 1) {
    return null; // can't pair multiple gws param blobs to verbs reliably
  }

  return targets.length === verbs.length ? targets : null;
}

/** Fetch wrapper — overridable in tests. */
export let runGog = (args: string[]): string =>
  execFileSync("gog", args, { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] });
export function _setRunGogForTests(fn: (args: string[]) => string) {
  runGog = fn;
}

interface CalVerdict {
  verdict: "solo" | "shared" | "unknown";
  detail: string;
}

export function classifyCalendarEvent(calendarId: string, eventId: string): CalVerdict {
  try {
    const out = runGog(["calendar", "event", calendarId, eventId, "--json"]);
    const ev = JSON.parse(out)?.event ?? {};
    const attendees: Array<{ email?: string; displayName?: string; self?: boolean }> =
      ev.attendees ?? [];
    const others = attendees.filter(
      (a) => !(a.self === true || OWN_EMAILS.has((a.email ?? "").toLowerCase())),
    );
    if (others.length === 0) {
      return { verdict: "solo", detail: `"${ev.summary ?? eventId}" has no other attendees` };
    }
    return {
      verdict: "shared",
      detail: `"${ev.summary ?? eventId}" has other attendees: ${others
        .map((o) => o.email ?? o.displayName ?? "?")
        .join(", ")}`,
    };
  } catch (e) {
    return { verdict: "unknown", detail: `could not fetch event ${eventId}: ${(e as Error).message?.slice(0, 100)}` };
  }
}

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

    // ── Calendar deletion: allow solo events, block shared ones ──
    let askForCalendar: string | null = null;
    if (CAL_DELETE_RE.test(command)) {
      const targets = extractCalDeleteTargets(command);
      if (!targets) {
        askForCalendar =
          "could not parse the delete target — use the form `gog calendar delete <calendarId> <eventId>`, one event per command";
      } else {
        for (const t of targets) {
          const { verdict, detail } = classifyCalendarEvent(t.calendarId, t.eventId);
          if (verdict === "shared") {
            return {
              block: true,
              reason: `Calendar deletion blocked: ${detail}. Events with other people on the attendee list must never be deleted by the agent — surface to Chris instead.`,
            };
          }
          if (verdict === "unknown") askForCalendar = detail;
          // verdict === "solo" → deletion allowed, keep checking other targets
        }
      }
    }

    // ── Tier 2: ASK (confirm in TTY, block otherwise) ──
    const askMatch = matchAny(command, askPatterns);
    if (askMatch || askForCalendar) {
      const why = askForCalendar ? ` (calendar check: ${askForCalendar})` : "";
      if (!ctx.hasUI) {
        return {
          block: true,
          reason: `Irreversible command blocked (no TTY)${why}: "${command.slice(0, 120)}"`,
        };
      }

      const choice = await ctx.ui.select(
        `⚠️  Irreversible command${why}:\n\n  ${command.slice(0, 200)}\n\nAllow?`,
        ["No — block it", "Yes — let it run"],
      );

      if (choice !== "Yes — let it run") {
        return { block: true, reason: "Blocked by user" };
      }
    }

    return;
  });
}
