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

const evidencePathRe = String.raw`(?:(?:~|/home/cp)/\.pi/agent/sessions/|(?:~|/home/cp)/\.pi/cost/|/tmp/(?:agent-dispatch|agent-stalls|telegram-send-audit)\.jsonl)`;

const evidenceTamperPatterns: RegExp[] = [
  new RegExp(String.raw`(?:^|[\s;&|])rm\b[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])mv\b[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])cp\b[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])truncate\b[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])tee\b[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])sed\b[^;&|\n]*\s-i(?:\s|$)[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[\s;&|])perl\b[^;&|\n]*\s-pi(?:\s|$)[^;&|\n]*${evidencePathRe}`),
  new RegExp(String.raw`(?:^|[^>])>{1,2}\s*${evidencePathRe}`),
];

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

// ── Calendar event mutation: attendee-aware ───────────────────────────────
//
// Solo events (no attendees, or every attendee is Chris himself) may be
// deleted or updated without prompting. Events with anyone else on the attendee
// list are BLOCKED outright — the agent must never mutate those; surface to
// Chris. Commands we can't parse, or events we can't fetch, fall back to the ASK
// tier (confirm in TTY, block headless). Updates that add attendees or notify
// external guests also fall back to ASK/block-headless.

const OWN_EMAILS = new Set(["chris.p@rsons.org", "cp@cherrypick.co"]);

const CAL_DELETE_RE =
  /\bgog\s+(?:calendar|cal)\s+(?:delete|rm|del|remove)\b|\bgws\s+calendar\s+events\s+delete\b/;
const CAL_UPDATE_RE = /\bgog\s+(?:calendar|cal)\s+update\b/;

interface CalEventTarget {
  calendarId: string;
  eventId: string;
}

/**
 * Extract (calendarId, eventId) for every calendar-delete in the command.
 * Returns null when any delete can't be parsed (variables, odd flag order,
 * more than one gws delete) — callers must then fall back to ASK.
 */
export function extractCalDeleteTargets(command: string): CalEventTarget[] | null {
  const verbs = command.match(new RegExp(CAL_DELETE_RE.source, "g")) ?? [];
  if (verbs.length === 0) return [];

  const targets: CalEventTarget[] = [];

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

function shellTokens(command: string): string[] | null {
  const tokens: string[] = [];
  let cur = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;

  for (const ch of command) {
    if (escaped) {
      cur += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }

  if (quote) return null;
  if (escaped) cur += "\\";
  if (cur) tokens.push(cur);
  return tokens;
}

function hasShellControlOutsideQuotes(command: string): boolean {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      continue;
    }
    if (";|&<>`\n".includes(ch)) return true;
    if (ch === "$") return true; // command substitution / shell variables: don't special-case as safe
  }
  return false;
}

function simpleCommandTokens(command: string): string[] | null {
  if (hasShellControlOutsideQuotes(command)) return null;
  return shellTokens(command);
}

function unquotedCommandText(command: string): string {
  let out = "";
  let quote: "'" | '"' | null = null;
  let escaped = false;
  for (const ch of command) {
    if (escaped) {
      if (!quote) out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      if (!quote) out += ch;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else if (/\s/.test(ch)) out += " ";
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

function nestedShellCommand(command: string): string | null {
  const tokens = shellTokens(command);
  if (!tokens?.length) return null;
  const exe = tokens[0].split("/").at(-1);
  if (!["bash", "sh", "zsh"].includes(exe ?? "")) return null;
  const cIdx = tokens.findIndex((t) => t === "-c");
  if (cIdx === -1) return null;
  return tokens[cIdx + 1] ?? null;
}

function isReadOnlySearchCommand(command: string): boolean {
  const tokens = simpleCommandTokens(command);
  if (!tokens?.length) return false;
  return ["rg", "grep", "egrep", "fgrep", "ag", "ack"].includes(tokens[0]);
}

function isHelpCommand(command: string): boolean {
  const tokens = simpleCommandTokens(command);
  if (!tokens?.length) return false;
  return tokens.includes("--help") || tokens.includes("-h") || tokens.at(-1) === "help";
}

function hasFlag(tokens: string[], name: string): boolean {
  return tokens.some((t) => t === name || t.startsWith(`${name}=`));
}

function flagValue(tokens: string[], name: string): string | null {
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === name) return tokens[i + 1] ?? null;
    if (t.startsWith(`${name}=`)) return t.slice(name.length + 1);
  }
  return null;
}

function isCalendarDryRunCommand(command: string): boolean {
  if (!(CAL_UPDATE_RE.test(command) || /\bgws\s+calendar\s+events\s+(?:patch|update)\b/.test(command))) {
    return false;
  }
  const tokens = simpleCommandTokens(command);
  return !!tokens && hasFlag(tokens, "--dry-run");
}

function skipLeadingFlags(tokens: string[], idx: number): number {
  const flagsWithSeparateValue = new Set(["--account", "-a", "--profile", "--auth"]);
  while (idx < tokens.length && tokens[idx].startsWith("-")) {
    const flag = tokens[idx];
    idx += 1;
    if (!flag.includes("=") && flagsWithSeparateValue.has(flag) && idx < tokens.length) idx += 1;
  }
  return idx;
}

export function extractCalUpdateTargets(command: string): CalEventTarget[] | null {
  const tokens = simpleCommandTokens(command);
  if (!tokens) return null;

  const targets: CalEventTarget[] = [];
  for (let i = 0; i < tokens.length - 2; i++) {
    if (tokens[i] !== "gog") continue;
    if (!(tokens[i + 1] === "calendar" || tokens[i + 1] === "cal")) continue;
    if (tokens[i + 2] !== "update") continue;
    let j = skipLeadingFlags(tokens, i + 3);
    if (j + 1 >= tokens.length || tokens[j].startsWith("-") || tokens[j + 1].startsWith("-")) return null;
    targets.push({ calendarId: tokens[j], eventId: tokens[j + 1] });
  }

  const verbs = command.match(new RegExp(CAL_UPDATE_RE.source, "g")) ?? [];
  return targets.length === verbs.length ? targets : null;
}

function calendarUpdateAskReason(command: string): string | null {
  if (!CAL_UPDATE_RE.test(command)) return null;
  const tokens = simpleCommandTokens(command);
  if (!tokens) return "could not parse calendar update command";

  const sendUpdates = flagValue(tokens, "--send-updates");
  if (sendUpdates === "all" || sendUpdates === "externalOnly") {
    return `calendar update would send attendee notifications (--send-updates ${sendUpdates})`;
  }
  if (hasFlag(tokens, "--attendees") || hasFlag(tokens, "--add-attendee")) {
    return "calendar update would add or replace attendees";
  }

  const targets = extractCalUpdateTargets(command);
  if (!targets) return "could not parse the update target — use the form `gog calendar update <calendarId> <eventId>`";
  for (const t of targets) {
    const { verdict, detail } = classifyCalendarEvent(t.calendarId, t.eventId);
    if (verdict === "shared") {
      return `BLOCK_SHARED:${detail}`;
    }
    if (verdict === "unknown") return detail;
  }
  return null;
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
    const externalOrganizer = ev.organizer?.email && ev.organizer?.self !== true && !OWN_EMAILS.has(String(ev.organizer.email).toLowerCase())
      ? String(ev.organizer.email)
      : null;
    const externalCreator = ev.creator?.email && ev.creator?.self !== true && !OWN_EMAILS.has(String(ev.creator.email).toLowerCase())
      ? String(ev.creator.email)
      : null;
    const others = attendees.filter(
      (a) => !(a.self === true || OWN_EMAILS.has((a.email ?? "").toLowerCase())),
    );
    if (externalOrganizer || externalCreator) {
      return {
        verdict: "shared",
        detail: `"${ev.summary ?? eventId}" is organised/created by ${externalOrganizer ?? externalCreator}`,
      };
    }
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

    // Match against executable shell text, not quoted prose arguments. If the
    // command is an explicit shell interpreter (`bash -c "..."`), inspect the
    // nested script instead — quoted there really is executable.
    const nested = nestedShellCommand(command);
    const commandToCheck = nested ?? command;
    const scanCommand = nested ?? unquotedCommandText(command);

    // Pure source/docs searches are observational. Do not block them just
    // because the query text mentions a guarded command.
    if (isReadOnlySearchCommand(commandToCheck)) return;

    // ── Tier 1: BLOCK (always denied) ──
    const evidenceTamperMatch = matchAny(scanCommand, evidenceTamperPatterns);
    if (evidenceTamperMatch) {
      return {
        block: true,
        reason: `Evidence-log tampering blocked: matched "${evidenceTamperMatch.source}"`,
      };
    }

    const blockMatch = matchAny(scanCommand, blockPatterns);
    if (blockMatch) {
      return {
        block: true,
        reason: `Destructive rm blocked (recursive or wildcard): matched "${blockMatch.source}"`,
      };
    }

    // Help and dry-run invocations are observational. Allow them before the
    // mutating calendar checks, but after the hard rm guard.
    if (isHelpCommand(commandToCheck) || isCalendarDryRunCommand(commandToCheck)) return;

    // ── Calendar deletion/update: allow solo own events, block shared ones ──
    let askForCalendar: string | null = null;
    if (CAL_DELETE_RE.test(scanCommand)) {
      const targets = extractCalDeleteTargets(commandToCheck);
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

    if (CAL_UPDATE_RE.test(scanCommand)) {
      const reason = calendarUpdateAskReason(commandToCheck);
      if (reason?.startsWith("BLOCK_SHARED:")) {
        return {
          block: true,
          reason: `Calendar update blocked: ${reason.slice("BLOCK_SHARED:".length)}. Events with other people on the attendee list must never be changed by the agent — surface to Chris instead.`,
        };
      }
      if (reason) askForCalendar = reason;
    }

    // ── Tier 2: ASK (confirm in TTY, block otherwise) ──
    const askMatch = matchAny(scanCommand, askPatterns);
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
