/**
 * Tool Call Cap Extension
 *
 * Bounds a single agent run's tool-call count to stop runaway loops. A stuck
 * triage run made 6,148 bash calls in one session (2026-05-28) costing $3.59;
 * this caps that class of failure.
 *
 * Opt-in via env var so it does NOT affect the worker (which legitimately runs
 * long). Set PI_MAX_TOOL_CALLS=<N> in the invocation you want capped — the
 * inbox-watcher sets it; worker/dream/vcp leave it unset and are unaffected.
 *
 * Behaviour: once the run exceeds N tool calls, every further tool call is
 * blocked with an instruction to stop and exit. The model wraps up cleanly
 * (vs a hard kill) — triage is idempotent, so anything unprocessed is picked
 * up on the next watcher cycle.
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CAP = parseInt(process.env.PI_MAX_TOOL_CALLS || "0", 10);

export default function (pi: ExtensionAPI) {
  // Disabled unless a positive cap is set in the environment.
  if (!Number.isFinite(CAP) || CAP <= 0) return;

  let toolCalls = 0;

  // Reset the counter at the start of each agent run (matters for interactive
  // sessions that run multiple turns in one process; harmless for `-p` runs).
  pi.on("before_agent_start", async () => {
    toolCalls = 0;
    return;
  });

  pi.on("tool_call", async () => {
    toolCalls++;
    if (toolCalls > CAP) {
      return {
        block: true,
        reason:
          `Tool-call cap reached (${CAP}). This run has made too many tool ` +
          `calls and is likely stuck in a loop. STOP NOW: do not call any ` +
          `more tools. Write a one-line summary of what you completed and ` +
          `what remains, then exit. Unprocessed items will be picked up on ` +
          `the next triage cycle.`,
      };
    }
    return;
  });
}
