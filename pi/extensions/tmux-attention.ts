/**
 * tmux Attention Extension
 *
 * Shows the shared tmux attention marker (the ❖ suffix from
 * ~/code/dotfiles/bin/tmux-attention) when pi finishes its turn or blocks on a
 * user prompt, and clears it while pi is working. Same window-name behaviour
 * Chris already gets from Claude Code's Stop/Notification hooks and Codex's
 * notify hooks — this wires pi's events to the same script.
 *
 * Mapping (Claude Code hook → pi event):
 *   UserPromptSubmit  → before_agent_start        → clear
 *   PostToolUse       → tool_execution_start      → clear
 *   Stop              → agent_settled             → waiting
 *   PermissionRequest → ui_prompt_start           → waiting
 *   (permission ok)   → ui_prompt_end             → clear
 *
 * agent_settled is used instead of agent_end because pi may auto-retry or
 * continue with queued messages after a single run ends; settled means the
 * turn is really over. Best-effort: a tmux failure must never break a turn.
 *
 * Place in ~/.pi/agent/extensions/ for auto-discovery.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const SCRIPT = join(homedir(), "code", "dotfiles", "bin", "tmux-attention");

export default function (pi: ExtensionAPI) {
  let last: "waiting" | "clear" | undefined;
  // Serialize spawns: detached spawns race, and an old "waiting" rename can
  // land after a newer "clear", leaving the ❖ stuck for a whole turn (the
  // dedupe then suppresses every clear). Chaining keeps rename order = event
  // order. Each run resolves when the tmux-attention script exits.
  let chain: Promise<void> = Promise.resolve();

  function run(state: "waiting" | "clear", cwd: string) {
    return new Promise<void>((resolve) => {
      try {
        appendFileSync("/tmp/pi-tmux-attention.log", `${new Date().toISOString()} ${state}\n`);
      } catch {
        // Diagnostics must never break a turn.
      }
      try {
        const child = spawn("bash", [SCRIPT, state], {
          env: process.env,
          stdio: ["pipe", "ignore", "ignore"],
        });
        // Payload matches the Claude Code / Codex hook contract: only used when
        // TMUX_PANE is unset (headless runs), to find the pane by cwd.
        child.stdin.end(JSON.stringify({ cwd }));
        child.on("close", () => resolve());
        child.on("error", () => resolve());
      } catch {
        resolve();
      }
    });
  }

  function signal(state: "waiting" | "clear", cwd: string) {
    // Skip redundant renames; tmux-attention is idempotent but each call spawns
    // a bash + several tmux commands.
    if (state === last) return;
    last = state;
    chain = chain.then(() => run(state, cwd), () => run(state, cwd));
  }

  pi.on("before_agent_start", async (_event, ctx) => {
    signal("clear", ctx.cwd);
  });

  pi.on("tool_execution_start", async (_event, ctx) => {
    signal("clear", ctx.cwd);
  });

  pi.on("agent_settled", async (_event, ctx) => {
    signal("waiting", ctx.cwd);
  });

  pi.on("ui_prompt_start", async (_event, ctx) => {
    signal("waiting", ctx.cwd);
  });

  pi.on("ui_prompt_end", async (_event, ctx) => {
    signal("clear", ctx.cwd);
  });
}
