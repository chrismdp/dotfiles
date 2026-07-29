/**
 * Language Guard — silent banned-word RETRY (the agent gets another go).
 *
 * When an assistant message contains a banned output term, this asks the agent to
 * REGENERATE the reply without the term, so Chris only ever reads a clean version —
 * never the banned word and never a "you used a banned word" notice. Mechanism: queue
 * an internal follow-up user message ("that used a banned term — write it again
 * without it"). pi drains follow-ups within the same run (print mode included, via
 * _handlePostAgentRun), so the regenerated reply becomes the final answer that the
 * dispatcher / telegram-stream surfaces. The banned attempt is never the final answer.
 *
 * There is NO redaction floor: if the model keeps using a term past MAX_RETRIES the
 * raw word ships as-is. Chris accepted that (he wants the retry, not a placeholder),
 * and the cap stops a stubborn model from looping. Only answer-shaped replies are
 * guarded — turns that make a tool call are mid-work narration, not the final reply.
 *
 * Banned list: single source of truth in agents/banned-words.txt — the SAME file
 * agent-dispatch.sh injects into the system prompt. Lowercase term → any case +
 * plural; Capitalised term → that exact case only. The matching rule is also encoded
 * in agent-dispatch.sh's prompt builder (different language, same .txt) — keep the two
 * in step if you change it.
 *
 * TESTS: language-guard.test.mjs (same dir). Run:
 *   node --experimental-strip-types ~/.pi/agent/extensions/language-guard.test.mjs
 */

import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const BANNED_FILE = "/home/cp/vault/agents/banned-words.txt";
const BANNED_FALLBACK = ["goblin", "clipboard", "moustache", "gremlin", "eyebrow", "Tiny"];
// Regeneration nudges per run before falling through to the redaction floor. A clean
// reply almost always comes on the first retry; the second is margin. Bounded so a
// model that stubbornly repeats a term can't loop. Tunable.
const MAX_RETRIES = 2;

function escapeRe(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function loadBannedTerms(): string[] {
	try {
		const lines = fs.readFileSync(BANNED_FILE, "utf8").split("\n").map((l) => l.trim());
		const terms = lines.filter((l) => l && !l.startsWith("#"));
		if (terms.length) return terms;
	} catch { /* fall through to the built-in list */ }
	return BANNED_FALLBACK;
}

/**
 * The banned terms actually present in `text`, in the casing the list defines them.
 * Matches the term and its simple +s plural; a lowercase term matches any case, a term
 * with a capital matches that exact case (so "Tiny" is caught but everyday "tiny" is
 * not). Deliberately simple — every banned word is a plain alphabetic noun. If you ever
 * add one that needs richer matching (an -es/-ies plural, or a special char like "C++"),
 * extend this then, when the exact case is known.
 */
export function bannedTermsIn(text: string): string[] {
	const hits: string[] = [];
	for (const t of loadBannedTerms()) {
		const flags = t === t.toLowerCase() ? "i" : "";
		if (new RegExp(`\\b${escapeRe(t)}s?\\b`, flags).test(text)) hits.push(t);
	}
	return hits;
}

function textOf(message: unknown): string {
	const c = (message as { content?: unknown })?.content;
	if (typeof c === "string") return c;
	if (!Array.isArray(c)) return "";
	return c
		.filter((b): b is { type?: string; text?: string } => !!b && typeof b === "object")
		.filter((b) => b.type === "text" && typeof b.text === "string")
		.map((b) => b.text as string)
		.join("");
}

/** True if the message makes a tool call — i.e. it's mid-work, not a final reply. */
function hasToolCall(message: unknown): boolean {
	const c = (message as { content?: unknown })?.content;
	if (!Array.isArray(c)) return false;
	return c.some((p) => !!p && typeof p === "object"
		&& ((p as { type?: string }).type === "toolCall" || (p as { type?: string }).type === "tool_use"));
}

export default function (pi: ExtensionAPI) {
	let retries = 0;
	pi.on("message_end", async (event) => {
		const msg = (event as { message?: { role?: string; content?: unknown } }).message;
		if (!msg || msg.role !== "assistant") return undefined;
		// Skip tool-call turns: they're mid-work narration, not the final answer Chris
		// reads. Regenerating one is meaningless and would burn the retry budget before
		// the real final reply (which is always a text-only assistant turn) gets here.
		if (hasToolCall(msg)) return undefined;
		const hits = bannedTermsIn(textOf(msg));
		if (hits.length === 0) return undefined;
		// Out of retries: stop nudging and let the (still-banned) reply ship as-is.
		// Bounded so a stubborn model can't loop; Chris accepted seeing the word here.
		if (retries >= MAX_RETRIES) return undefined;
		retries++;
		const list = hits.map((t) => `"${t}"`).join(", ");
		// Internal follow-up user message → triggers one more agent turn. Awaited so the
		// follow-up is queued before this handler returns (before the run can wind down).
		await Promise.resolve(
			pi.sendUserMessage(
				`⚠️ Internal note (NOT from Chris — do not acknowledge or mention it): your previous reply used the banned term ${list}, which Chris must never see. Write your reply again — same content, same intent, same voice — reworded so it contains neither ${list} nor any other banned term. Send only the rewritten reply.`,
				{ deliverAs: "followUp" },
			),
		);
		return undefined;
	});
}
