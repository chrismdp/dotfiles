/**
 * Telegram Stream Extension — interactive progress bubble
 *
 * Interactive agent runs should feel live without spraying the chat. Intermediate
 * assistant texts accumulate into one silent Telegram bubble that is edited in place.
 * On run end, the final answer is edited/sent silently in that same bubble. The
 * working trail is deliberately dropped from the final render: Telegram clients do
 * not hide expandable quotes consistently enough for busy production runs.
 *
 * Cron/routed/manual stimuli leave PI_TG_STREAM unset, so the extension is inert and
 * quote-on-reply / NO_REPORT silence semantics stay in agent-dispatch.sh.
 *
 * Safety handshake: agent-dispatch exports PI_TG_STREAM_STATE. If this extension
 * successfully places the final answer, it writes {final_sent:true,bubble_id}. The
 * dispatcher then skips its normal final send. If Telegram rejects the edit, or the
 * final text is too long for one edited bubble, the dispatcher falls back to a silent
 * chunked send via send.sh.
 *
 * TESTS: telegram-stream.test.mjs mocks fetch + a fake pi and asserts intermediate
 * editing, final-at-top rendering, state-file handoff, and fallback cases. Run:
 *   node --experimental-strip-types ~/.pi/agent/extensions/telegram-stream.test.mjs
 */

import fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOKEN = /^(NO[_ ]?REPORT|REPORT|PORT|REACT)\s*(:.*)?$/i;
const MAX = 3900; // rendered HTML length; keep comfortably under Telegram's 4096 hard limit
const PREFIX = "💭 ";
const SEP = "\n\n";

// Banned-word handling lives in the language-guard.ts extension (it regenerates any
// reply that uses one). Vault wikilinks are flattened at this boundary too, the same
// way send.sh does — this extension posts straight to the Telegram API and never
// passes through send.sh, so without the flatten a reply can carry raw [[target]]
// markup to Chris (2026-09-12: bella replied with a live [[2026-W37]]).

function flattenWikilinks(s: string): string {
	return s
		.replace(/\[\[([^\]|\n]+)\|([^\]\n]+)\]\]/g, "$2")
		.replace(/\[\[([^\]\n]+)\]\]/g, "$1");
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

function stripControlTokens(text: string): string {
	return text
		.split("\n")
		.filter((ln) => !TOKEN.test(ln.trim()))
		.join("\n")
		.trim();
}

function looksLikeInternalEditPacket(text: string): boolean {
	// Subagents often return machine-targeted edit batches for the parent to apply.
	// They are useful backstage, but miserable as live Telegram progress: a user sees
	// raw old/new replacement payloads rather than the agent's actual answer.
	const hasFilePath = /\bfile[_-]?path\b/i.test(text);
	const hasOld = /\b(old[_-]?string|oldText)\b/i.test(text);
	const hasNew = /\b(new[_-]?string|newText)\b/i.test(text);
	return hasFilePath && hasOld && hasNew;
}

function streamExtension(pi: ExtensionAPI) {
	if (process.env.PI_TG_STREAM !== "1") return; // gated off — inert

	const botVar = process.env.PI_TG_BOT_VAR || "";
	const token = botVar ? process.env[botVar] || "" : "";
	const chatId = process.env.TELEGRAM_CHAT_ID || "";
	const statePath = process.env.PI_TG_STREAM_STATE || "";
	if (!token || !chatId) {
		process.stderr.write("[telegram-stream] missing bot token or chat id — inert\n");
		return;
	}

	let bubbleId: number | null = null;
	let committed: string[] = [];
	let pending: string | null = null;
	let pendingControlEnd = false;  // last assistant message stripped to empty (NO_REPORT etc.)
	let finalised = false;
	// Serialise state mutations: message_end handlers and beforeExit can overlap, and
	// the bubble state (id/text/pending) is shared. Chain each mutation so commits stay
	// ordered and never race.
	let chain: Promise<void> = Promise.resolve();

	function writeState(data: Record<string, unknown>): void {
		if (!statePath) return;
		try { fs.writeFileSync(statePath, JSON.stringify({ ts: new Date().toISOString(), ...data })); }
		catch { /* best effort only */ }
	}

	async function tg(method: string, body: Record<string, unknown>): Promise<{ result?: { message_id?: number } } | null> {
		try {
			const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			const data = (await r.json()) as { ok?: boolean; result?: { message_id?: number } | boolean; description?: string };
			if (data && data.ok === false) {
				process.stderr.write(`[telegram-stream] ${method} rejected: ${data.description || "unknown"}\n`);
				return null;
			}
			return data as { result?: { message_id?: number } };
		} catch (e) {
			process.stderr.write(`[telegram-stream] ${method} failed: ${(e as Error).message}\n`);
			return null;
		}
	}

	function escapeHtml(s: string): string {
		return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
	}

	function inlineMarkdownEscaped(s: string): string {
		return s
			.replace(/(?<!`)`([^`\n]+)`(?!`)/g, "<code>$1</code>")
			.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2">$1</a>')
			.replace(/\*\*([^*\n]+?)\*\*/g, "<b>$1</b>")
			.replace(/(?<![\w*])\*([^*\n]+?)\*(?![\w*])/g, "<b>$1</b>")
			.replace(/(?<![\w_])_([^_\n]+?)_(?![\w_])/g, "<i>$1</i>");
	}

	function renderMarkdown(s: string): string {
		s = flattenWikilinks(s);
		const pres: string[] = [];
		const stashed = s.replace(/```(?:[\w+-]*\n)?([\s\S]*?)```/g, (_m, body) => {
			pres.push(String(body));
			return `\u0000PRE${pres.length - 1}\u0000`;
		});
		const parts = escapeHtml(stashed).split(/\u0000PRE(\d+)\u0000/);
		return parts.map((part, i) => {
			if (i % 2 === 1) return `<pre>${escapeHtml(pres[Number(part)] || "")}</pre>`;
			return inlineMarkdownEscaped(part);
		}).join("");
	}

	function renderParts(parts: string[]): string {
		if (parts.length === 0) return PREFIX.trim();
		const latest = parts[parts.length - 1];
		const older = parts.slice(0, -1).join(SEP);
		if (!older) return `${PREFIX}${renderMarkdown(latest)}`;
		// Keep quoted trail plain/escaped. Telegram accepts simple expandable quotes
		// reliably; nested formatting inside quotes is more fragile and the trail is
		// secondary context, not the payload.
		return `${PREFIX}<blockquote expandable>${escapeHtml(older)}</blockquote>${SEP}${renderMarkdown(latest)}`;
	}

	function render(parts: string[]): string {
		const safe = [...parts];
		while (safe.length > 1) {
			const body = renderParts(safe);
			if (body.length <= MAX) return body;
			safe.shift(); // keep the most recent updates; old ones are least useful
		}
		let latest = safe[0] || "";
		while (latest.length > 0) {
			const body = renderParts([`…${latest}`]);
			if (body.length <= MAX) return body;
			latest = latest.slice(Math.ceil(latest.length / 10));
		}
		return PREFIX.trim();
	}

	function renderFinal(finalText: string, _trail: string[]): string | null {
		const finalHtml = renderMarkdown(finalText);
		// Do not truncate final answers. If the final itself is too large for one edit,
		// let agent-dispatch send the full answer in silent chunks.
		if (finalHtml.length > MAX) return null;
		return finalHtml;
	}

	async function commit(text: string): Promise<boolean> {
		committed = [...committed, text];
		const body = render(committed);
		if (bubbleId === null) {
			const res = await tg("sendMessage", { chat_id: chatId, text: body, parse_mode: "HTML", disable_notification: true });
			const id = res?.result?.message_id;
			if (typeof id === "number") { bubbleId = id; writeState({ final_sent: false, bubble_id: id }); return true; }
			return false;
		}
		const res = await tg("editMessageText", { chat_id: chatId, message_id: bubbleId, text: body, parse_mode: "HTML" });
		return !!res;
	}

	async function abandonBubble(reason: string): Promise<void> {
		if (finalised) return;
		finalised = true;
		try {
			if (bubbleId !== null) await tg("deleteMessage", { chat_id: chatId, message_id: bubbleId });
		} catch { /* best effort */ }
		writeState({ final_sent: false, reason, bubble_id: bubbleId });
	}

	async function placeFinal(finalText: string): Promise<void> {
		if (finalised) return;
		finalised = true;
		const body = renderFinal(finalText, committed);
		if (!body) {
			writeState({ final_sent: false, reason: "too_long" });
			return;
		}
		if (bubbleId === null) {
			const res = await tg("sendMessage", { chat_id: chatId, text: body, parse_mode: "HTML", disable_notification: true });
			const id = res?.result?.message_id;
			if (typeof id === "number") { bubbleId = id; writeState({ final_sent: true, bubble_id: id, mode: "send" }); return; }
			writeState({ final_sent: false, reason: "send_failed" });
			return;
		}
		const res = await tg("editMessageText", { chat_id: chatId, message_id: bubbleId, text: body, parse_mode: "HTML" });
		if (res) writeState({ final_sent: true, bubble_id: bubbleId, mode: "edit" });
		else writeState({ final_sent: false, reason: "edit_failed", bubble_id: bubbleId });
	}

	pi.on("message_end", (event) => {
		const msg = (event as { message?: { role?: string } }).message;
		if (!msg || msg.role !== "assistant") return undefined;
		const text = stripControlTokens(textOf(msg));
		if (!text || looksLikeInternalEditPacket(text)) {
			// The message was a control token (NO_REPORT/REACT) or an internal edit
			// packet — mark this so beforeExit knows the run ended without a real
			// answer and won't place a stale intermediate as the final.
			if (text === "" && msg.content && Array.isArray(msg.content)) {
				// Only control-token strips: the raw text was non-empty but stripped empty.
				const raw = textOf(msg);
				if (raw.trim()) pendingControlEnd = true;
			}
			return undefined;
		}
		pendingControlEnd = false;
		// Lookahead while the run is active: commit the PREVIOUS pending into the bubble;
		// hold THIS text as the candidate final. beforeExit places that candidate at the
		// top of the same bubble once pi has no more work to do.
		chain = chain.then(async () => {
			try {
				if (pending !== null) await commit(pending);
				pending = text;
			} catch (err) {
				process.stderr.write(`[telegram-stream] ${(err as Error).message}\n`);
			}
		});
		return chain;
	});

	process.once("beforeExit", () => {
		// The run's final answer was a control token (NO_REPORT etc.) — the agent
		// decided to stay silent. Don't place a stale intermediate text as the
		// bubble's final; delete the progress bubble (if any) and tell the dispatcher
		// so it does its normal NO_REPORT handling (reaction/silence).
		if (pendingControlEnd) {
			chain = chain
				.then(() => abandonBubble("control_token"))
				.catch(() => writeState({ final_sent: false, reason: "abandon_failed" }));
			return;
		}
		if (finalised || pending === null) return;
		chain = chain
			.then(() => pending === null ? undefined : placeFinal(pending))
			.catch((err) => {
				process.stderr.write(`[telegram-stream] ${(err as Error).message}\n`);
				writeState({ final_sent: false, reason: "exception" });
			});
	});

	// SIGTERM (stall-kill, timeout, preempt) and SIGINT: delete the in-flight bubble
	// so a killed run doesn't leave a frozen half-thought visible in the chat. The
	// retry or preempting run starts fresh without a ghost bubble. Exit with the
	// conventional signal-exit code so the dispatcher classifies it correctly.
	let dying = false;
	function onSignal(_sig: string, code: number) {
		if (dying) return;
		dying = true;
		void chain.then(() => abandonBubble("interrupted"));
		// Exit after a short delay so the chain can flush. Don't throw through
		// the promise chain — the test harness may stub process.exit.
		setTimeout(() => process.exit(code), 100);
	}
	process.on("SIGTERM", () => onSignal("SIGTERM", 143));
	process.on("SIGINT", () => onSignal("SIGINT", 130));

	// Exported for tests: lets a test scenario force an abandon without sending
	// a real signal or calling process.exit.
	(streamExtension as unknown as Record<string, unknown>).__testAbandon = (reason: string) =>
		void chain.then(() => abandonBubble(reason));

	return streamExtension;
}

export default streamExtension;
