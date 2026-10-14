/**
 * Decision Log Guard Extension
 *
 * Blocks the write/edit tools from touching the decision log
 * (~/vault/projects/decisions/*.jsonl). The log is append-only and the
 * authoritative "has this been triaged?" record; rewriting it with the write
 * tool drops the newline between entries and clobbers entries a concurrent run
 * added (root cause traced 2026-05-31 — Flash was read-modify-writing the file
 * instead of appending). Prose instructions alone don't stop a model that
 * ignores them, so this enforces it at the tool layer.
 *
 * Universal (NOT env-gated): no agent should ever rewrite the decision log. The
 * only sanctioned write path is ~/vault/scripts/log-decision.sh (flock'd,
 * append-only, newline-safe).
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// Matches absolute, ~-relative, or repo-relative paths to a decisions JSONL.
const DECISION_LOG = /projects\/decisions\/[^/]*\.jsonl$/;

// Bash patterns that would TRUNCATE/overwrite the log (the corrupting ones).
// A single `>` redirect (not `>>` append) targeting the log, or `tee` without
// `-a`. Appends (`>>`, `tee -a`), reads, and the helper are all allowed.
const BASH_TRUNCATE = /(?<!>)>(?!>)\s*\S*projects\/decisions\/\S*\.jsonl/;
const BASH_TEE_OVERWRITE = /\btee\b(?!\s+-a\b)\s+\S*projects\/decisions\/\S*\.jsonl/;

const REASON =
  "The decision log is append-only — rewriting/truncating it drops entries and " +
  "breaks the JSONL (this is the bug traced 2026-05-31). Append your entry " +
  "instead: ~/vault/scripts/log-decision.sh '<json>' (one compact single-line " +
  "JSON object per call).";

export default function (pi: ExtensionAPI) {
  pi.on("tool_call", async (event) => {
    // 1. write/edit tool aimed at the log — always block (use the helper).
    if (event.toolName === "write" || event.toolName === "edit") {
      const input = event.input as Record<string, unknown> | undefined;
      const path = (input?.path ?? input?.file_path) as string | undefined;
      if (path && DECISION_LOG.test(path)) {
        return { block: true, reason: `Refusing to ${event.toolName} the decision log. ${REASON}` };
      }
      return;
    }

    // 2. bash truncate/overwrite of the log — block; appends + helper pass.
    if (event.toolName === "bash") {
      const cmd = (event.input as Record<string, unknown> | undefined)?.command as string | undefined;
      if (!cmd || /log-decision\.sh/.test(cmd)) return;
      if (BASH_TRUNCATE.test(cmd) || BASH_TEE_OVERWRITE.test(cmd)) {
        return { block: true, reason: `Refusing to overwrite the decision log via bash. ${REASON}` };
      }
    }
    return;
  });
}
