/**
 * Claude Rules Loader
 *
 * Auto-loads all .md files from .claude/rules/ (global + project)
 * into the system prompt on every agent start. No Read tool calls needed.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";

function discoverRuleDirs(cwd: string): string[] {
  const dirs: string[] = [];
  const globalDir = join(homedir(), ".claude", "rules");
  const projectDir = resolve(cwd, ".claude", "rules");

  if (existsSync(globalDir)) dirs.push(globalDir);
  if (projectDir !== globalDir && existsSync(projectDir)) dirs.push(projectDir);

  return dirs;
}

function loadRules(dirs: string[]): string {
  const blocks: string[] = [];

  for (const dir of dirs) {
    try {
      const files = readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort();

      for (const file of files) {
        const content = readFileSync(join(dir, file), "utf-8").trim();
        if (content) {
          blocks.push(`<!-- @.claude/rules/${file} -->\n\n${content}`);
        }
      }
    } catch {
      // dir doesn't exist or can't be read — skip
    }
  }

  return blocks.join("\n\n---\n\n");
}

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event, ctx) => {
    const dirs = discoverRuleDirs(ctx.cwd);
    if (dirs.length === 0) return;

    const rulesContent = loadRules(dirs);
    if (!rulesContent) return;

    return {
      systemPrompt:
        event.systemPrompt +
        "\n\n## Permanent Operating Rules (auto-loaded from .claude/rules/)\n\n" +
        rulesContent,
    };
  });
}
