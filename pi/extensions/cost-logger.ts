/**
 * Cost Logger Extension
 *
 * Logs one JSONL line per *provider API call* capturing model, provider, token
 * usage and cost — so every pi-driven agent (em, richard, penelope, bella,
 * worker, dream, vcp, the inbox triage runs, …) has a durable, queryable
 * cost+model record.
 *
 * Requested by Chris 2026-06-03: "all agents should actually track cost along
 * with the model they're using — some jsonl output in the harness around pi, or
 * as a pi hook."
 *
 * ── 2026-06-04 correctness fix ───────────────────────────────────────────────
 * Previously hooked `turn_end`, which fires ONCE per turn and carries only the
 * turn's FINAL assistant message. A single turn makes many provider calls (one
 * per tool-call round-trip), so the old logger captured ~1 in 3 calls and
 * undercounted real spend ~2.85× (measured against OpenRouter's activity export
 * for 2026-06-03: 264 logged rows vs 753 actual generations; $0.98 logged vs
 * $4.43 billed for Flash).
 *
 * Now hooks `message_end` and logs every assistant message that carries usage —
 * i.e. one row per provider API call, matching OpenRouter's generation count
 * 1:1. Token counts and per-call cost come from the message's own `usage`.
 *
 * Default-ON (not env-gated): the whole point is blanket coverage. Best-effort —
 * a logging failure must NEVER break a turn, so everything is wrapped and the
 * handler always returns cleanly.
 *
 * Output: ~/.pi/cost/YYYY-MM-DD.jsonl  (durable; override dir with PI_COST_LOG_DIR)
 *   {ts, agent, model, provider, in, out, reasoning, cacheR, cacheW, total, cost, cwd, pid, turn, seq}
 *
 * Note on cost accuracy: `cost` is Pi's own figure derived from models.json
 * rates. For OpenRouter models the real provider varies per call (OpenRouter
 * routes across Novita/Morph/Parasail/…), so Pi's cost is a close approximation
 * (within ~2% on Flash) but the authoritative figure is OpenRouter's activity
 * export. Token counts here are exact (from the provider response).
 *
 * Agent attribution, in priority order:
 *   1. $PI_COST_AGENT            — explicit label set by the caller (agent-dispatch sets it)
 *   2. cwd basename under agents/ — e.g. /home/cp/vault/agents/em → "em"
 *   3. cwd basename              — fallback for non-agent runs
 *
 * Query examples:
 *   jq -s 'group_by(.agent)[]|{agent:.[0].agent,cost:(map(.cost)|add)}' ~/.pi/cost/$(date +%F).jsonl
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function deriveAgent(cwd: string): string {
  const env = process.env.PI_COST_AGENT;
  if (env && env.trim()) return env.trim();
  const parts = (cwd || "").split("/").filter(Boolean);
  const i = parts.lastIndexOf("agents");
  if (i >= 0 && parts[i + 1]) return parts[i + 1]; // …/agents/<name>/…
  return parts[parts.length - 1] || "unknown";
}

export default function (pi: ExtensionAPI) {
  // Track the current turn index (message_end carries no turnIndex) and a
  // process-local monotonic call counter so rows are orderable within a run.
  let turnIndex = 0;
  let seq = 0;

  pi.on("turn_start", async (event) => {
    turnIndex = num((event as { turnIndex?: number }).turnIndex);
    return;
  });

  pi.on("message_end", async (event, ctx) => {
    try {
      const msg = (event as { message?: Record<string, unknown> }).message ?? {};
      // Only assistant messages correspond to a provider API call. User and
      // toolResult messages also fire message_end — skip them.
      if (msg.role !== "assistant") return;

      const usage = (msg.usage ?? {}) as Record<string, unknown>;
      // A finalised assistant message from a provider call carries token usage.
      // Skip anything without it (synthetic/aborted messages) so we never log a
      // zero-token phantom row.
      const inTok = num(usage.input);
      const outTok = num(usage.output);
      const totalTok = num(usage.totalTokens);
      if (inTok === 0 && outTok === 0 && totalTok === 0) return;

      const cost = (usage.cost ?? {}) as Record<string, unknown>;
      const model =
        (msg.model as string) ?? (ctx.model as { id?: string } | undefined)?.id ?? "unknown";
      const provider = (msg.provider as string) ?? "unknown";

      const dir = process.env.PI_COST_LOG_DIR || join(homedir(), ".pi", "cost");
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      mkdirSync(dir, { recursive: true });

      const line = {
        ts: now.toISOString(),
        agent: deriveAgent(ctx.cwd),
        model,
        provider,
        in: inTok,
        out: outTok,
        // reasoning tokens are billed as output by most providers but not always
        // broken out in usage; capture whichever field is present, else 0.
        reasoning: num(usage.reasoning ?? (usage as Record<string, unknown>).reasoningTokens),
        cacheR: num(usage.cacheRead),
        cacheW: num(usage.cacheWrite),
        total: totalTok,
        cost: num(cost.total),
        cwd: ctx.cwd,
        pid: process.pid,
        turn: turnIndex,
        seq: seq++,
      };
      appendFileSync(join(dir, `${day}.jsonl`), `${JSON.stringify(line)}\n`);
    } catch (err) {
      // Never break a turn over logging.
      process.stderr.write(`[cost-logger] ${(err as Error).message}\n`);
    }
    return;
  });
}
