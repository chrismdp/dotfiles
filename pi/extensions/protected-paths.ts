/**
 * Protected Paths Extension
 *
 * Prompts before write/edit to protected paths in interactive mode.
 * Blocks outright in non-interactive mode (worker, cron, etc.).
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
	const protectedPaths = [
  ".env",
  ".git/",
  "node_modules/",
  ".pi/agent/extensions/",
  "~/.pi/agent/extensions/",
  ".secret_env",
  ".pi/agent/settings.json",
  "~/.pi/agent/settings.json",
  ".pi/agent/keybindings.json",
  "~/.pi/agent/keybindings.json",
];

	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName !== "write" && event.toolName !== "edit") {
			return undefined;
		}

		const path = event.input.path as string;
		const isProtected = protectedPaths.some((p) => path.includes(p));

		if (isProtected) {
			if (!ctx.hasUI) {
				return { block: true, reason: `Path "${path}" is protected (no TTY)` };
			}

			const choice = await ctx.ui.select(
				`⚠️  Protected path:\n\n  ${path.slice(0, 120)}\n\nAllow write/edit?`,
				["No — block it", "Yes — let it write"],
			);

			if (choice !== "Yes — let it write") {
				return { block: true, reason: "Protected path blocked by user" };
			}
		}

		return undefined;
	});
}
