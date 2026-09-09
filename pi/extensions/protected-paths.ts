/**
 * Protected Paths Extension
 *
 * Prompts before write/edit to protected paths in interactive mode.
 * Blocks outright in non-interactive mode (worker, cron, etc.).
 * Reference sources have a stricter rule: agents may inspect and update
 * metadata, but only save-article.sh may create or overwrite source files.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const protectedPaths = [
	".env",
	".git/",
	"node_modules/",
	".pi/agent/extensions/",
	"~/.pi/agent/extensions/",
	".pi/agent/sessions/",
	"~/.pi/agent/sessions/",
	".pi/cost/",
	"~/.pi/cost/",
	"/tmp/agent-dispatch.jsonl",
	"/tmp/agent-stalls.jsonl",
	"/tmp/telegram-send-audit.jsonl",
	".secret_env",
	".pi/agent/settings.json",
	"~/.pi/agent/settings.json",
	".pi/agent/keybindings.json",
	"~/.pi/agent/keybindings.json",
];

const referencePath = String.raw`(?:^|/)links/reference/`;
const referenceToken = String.raw`(?:"[^"]*${referencePath}[^"]*"|'[^']*${referencePath}[^']*'|[^\s;&|]*${referencePath}[^\s;&|]*)`;

const referenceCreationPatterns = [
	new RegExp(String.raw`(?:^|[^>])>>?\s*${referenceToken}`, "m"),
	new RegExp(String.raw`\btee\s+[^\n;&|]*${referencePath}`, "m"),
	new RegExp(String.raw`\b(?:cp|mv|install|rsync)\s+[^\n;&|]*\s${referenceToken}\s*(?:$|[;&|])`, "m"),
	new RegExp(String.raw`\b(?:touch|truncate)\s+[^\n;&|]*${referencePath}`, "m"),
	new RegExp(String.raw`\bdd\b[^\n;&|]*\bof\s*=\s*${referenceToken}`, "m"),
	new RegExp(String.raw`\bsed\b[^\n;&|]*\s-i(?:\s|[^\s]*)[^\n;&|]*${referencePath}`, "m"),
	new RegExp(String.raw`\bPath\s*\([^)]*${referencePath}[^)]*\)\s*\.\s*write_(?:text|bytes)\s*\(`, "ms"),
	new RegExp(String.raw`\bopen\s*\([^,]*${referencePath}[^,]*,\s*["'][wax+]`, "ms"),
];

export function isReferencePath(path: string): boolean {
	return new RegExp(referencePath).test(path.replaceAll("\\", "/"));
}

export function bashCreatesReference(command: string): boolean {
	const normalised = command.replaceAll("\\", "/");
	if (!new RegExp(referencePath).test(normalised)) return false;
	return referenceCreationPatterns.some((pattern) => pattern.test(normalised));
}

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", async (event, ctx) => {
		if (event.toolName === "write") {
			const path = String((event.input as { path?: unknown }).path ?? "");
			if (isReferencePath(path)) {
				return {
					block: true,
					reason: `Reference source creation is saver-only: use save-article.sh instead of writing "${path}"`,
				};
			}
		}

		if (event.toolName === "bash") {
			const command = String((event.input as { command?: unknown }).command ?? "");
			if (bashCreatesReference(command)) {
				return {
					block: true,
					reason: "Reference source creation is saver-only: use save-article.sh instead of a shell write",
				};
			}
		}

		if (event.toolName !== "write" && event.toolName !== "edit") return undefined;

		const path = String((event.input as { path?: unknown }).path ?? "");
		const isProtected = protectedPaths.some((protectedPath) => path.includes(protectedPath));
		if (!isProtected) return undefined;

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

		return undefined;
	});
}
