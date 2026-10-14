/**
 * Triage Shadow Guard
 *
 * Makes the Em-as-triager SHADOW safe to run with REAL investigation tools
 * (read + bash) against live Gmail/vault — so it can fetch threads, run seen.sh,
 * grep the vault and match projects the way real triage does, WITHOUT ever
 * mutating state or sending anything.
 *
 * Layers ON TOP of bash-guard.ts (which already blocks the "leaves the building"
 * actions — real email send, deletes, calendar invites, git push, curl mutations).
 * This plugs the gaps bash-guard does NOT cover for a shadow:
 *   - gog/gws gmail ... modify  (mark-read / label changes)  ← the critical one
 *   - the edit / write tools     (Inbox.md deletion, note writes)  ← bash-guard only sees bash
 *   - enqueue.sh / send.sh / send-document.sh  (Telegram sends to Chris)
 *   - log-decision.sh            (would pollute the real decision log)
 *   - project-cli status mutations
 *   - shell write-redirects / tee / sponge / mv / cp / rm into the vault
 *
 * Gated on PI_TRIAGE_SHADOW=1 so it ONLY affects shadow runs — production
 * agents and the real triage are unaffected.
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const ON = process.env.PI_TRIAGE_SHADOW === "1";

// Mutating bash commands bash-guard doesn't catch — block outright in shadow.
const blockBash: RegExp[] = [
  /\bgog\s+gmail\b.*\bmodify\b/i,                 // mark-read / label add/remove
  /\bgws\s+gmail\s+users\s+messages\s+modify\b/i,
  /\bgws\s+gmail\s+users\s+threads\s+modify\b/i,
  /\bgmail-thread-safe\.sh\b.*--(modify|mark)/i,  // defensive (the script is read-only, but guard any mutate flag)
  /\benqueue\.sh\b/,                               // digest queue / urgent Telegram
  /\bsend(-document)?\.sh\b/,                      // direct Telegram send
  /\blog-decision\.sh\b/,                          // pollutes the real decision log
  /\bproject-cli(\.py)?\b/,                        // project status mutations
  /\bblogwatcher\b\s+(read|remove)\b/,             // marks blog items read
  /\bseen\.sh\b.*--(write|mark)/i,                 // seen.sh is read-only; guard any write flag
  // shell mutations into the filesystem
  /(^|\s)(rm|mv|cp|truncate|tee|sponge|install|dd)\s/,
  // output redirect to a real file — but NOT /dev/null or &N (stderr dups), which
  // are harmless and appear in almost every read command (e.g. `... 2>/dev/null`).
  />>?\s*(?!\/dev\/null\b)(?!&)\S/,
];

export default function (pi: ExtensionAPI) {
  if (!ON) return; // production / real triage: no-op

  pi.on("tool_call", async (event) => {
    const tool = event.toolName;

    // Hard-block all file-mutating tools — the shadow only investigates.
    if (tool === "edit" || tool === "write" || tool === "notebook_edit") {
      return { block: true, reason: `SHADOW: ${tool} blocked — read-only run, do not modify any file. State your REPORT / NO_REPORT verdict instead.` };
    }

    if (tool === "bash") {
      const cmd = (event.input?.command as string) || "";
      for (const p of blockBash) {
        if (p.test(cmd)) {
          return {
            block: true,
            reason: `SHADOW: command blocked (matched ${p.source}). This is a read-only judgement run — you may READ (gmail-thread-safe.sh, seen.sh, grep, review-board ls) but must NOT mark-read, send, enqueue, log, or write. Decide your verdict from what you can read.`,
          };
        }
      }
    }
    return;
  });
}
