/**
 * Telegram Stream Extension — "thought bubbles" (rewritten 2026-06-05)
 *
 * The old version sent EVERY mid-run assistant text as its own Telegram message →
 * one notification per step → spam. Now the intermediate texts accumulate into a
 * SINGLE "thinking" bubble that is EDITED in place. Telegram edits don't notify, so
 * a chatty run is silent until its answer lands.
 *
 * The FINAL answer is NOT streamed here. agent-dispatch.sh sends it as its own fresh
 * message after the run (one notification — the meaningful one), through send.sh
 * (markdown + 4096 chunking + audit trail). This extension only owns the bubble.
 *
 * How the final is held back without a run-end hook: a one-message LOOKAHEAD. Each
 * assistant text is held as `pending`; when the NEXT one arrives, the previous
 * `pending` is committed to the bubble. The LAST text is therefore never committed —
 * it stays pending when the run ends, and agent-dispatch emits it as the final
 * message. So:
 *   1 text  → no bubble at all, just agent-dispatch's final message
 *   N texts → bubble holds texts 1..N-1 (silent edits), agent-dispatch sends text N
 *
 * GATED on PI_TG_STREAM=1 (interactive dispatches only — see agent-dispatch.sh). Cron
 * sweeps leave it unset, so silent-unless-findings (NO_REPORT) still holds. When
 * inactive this extension is completely inert.
 *
 * TESTS: telegram-stream.test.mjs (same dir) mocks fetch + a fake pi and asserts the
 * lookahead (last text held back), the silent bubble send + in-place edits, and token /
 * tool / empty-text skipping. Run:
 *   node --experimental-strip-types ~/.pi/agent/extensions/telegram-stream.test.mjs
 *
 * Bubble I/O is direct Telegram API (sendMessage with disable_notification, then
 * editMessageText), using the agent's bot token from process.env[PI_TG_BOT_VAR] and
 * TELEGRAM_CHAT_ID — both inherited from agent-dispatch (which sources ~/.secret_env).
 * Plain text, no parse_mode: the bubble is ephemeral working narration, so we don't
 * risk a markdown parse error mid-stream; the final answer keeps full formatting via
 * send.sh. Tool calls / thinking blocks never stream; control tokens are stripped.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const TOKEN = /^(NO[_ ]?REPORT|REPORT|PORT)\s*(:.*)?$/;
const MAX = 3900; // keep the bubble comfortably under Telegram's 4096 hard limit
const PREFIX = "💭 ";
const SEP = "\n\n";

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

export default function (pi: ExtensionAPI) {
	if (process.env.PI_TG_STREAM !== "1") return; // gated off — inert

	const botVar = process.env.PI_TG_BOT_VAR || "";
	const token = botVar ? process.env[botVar] || "" : "";
	const chatId = process.env.TELEGRAM_CHAT_ID || "";
	if (!token || !chatId) {
		process.stderr.write("[telegram-stream] missing bot token or chat id — inert\n");
		return;
	}

	let bubbleId: number | null = null;
	let bubbleText = "";
	let pending: string | null = null;
	// Serialise state mutations: message_end handlers can overlap, and the bubble
	// state (id/text/pending) is shared. Chain each on the previous so commits stay
	// ordered and never race.
	let chain: Promise<void> = Promise.resolve();

	async function tg(method: string, body: Record<string, unknown>): Promise<{ result?: { message_id?: number } } | null> {
		try {
			const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			return (await r.json()) as { result?: { message_id?: number } };
		} catch (e) {
			process.stderr.write(`[telegram-stream] ${method} failed: ${(e as Error).message}\n`);
			return null;
		}
	}

	function clamp(s: string): string {
		const full = PREFIX + s;
		if (full.length <= MAX) return full;
		// keep the most recent thinking — truncate the head
		return `${PREFIX}…${s.slice(s.length - (MAX - PREFIX.length - 1))}`;
	}

	async function commit(text: string): Promise<void> {
		bubbleText += (bubbleText ? SEP : "") + text;
		const body = clamp(bubbleText);
		if (bubbleId === null) {
			const res = await tg("sendMessage", { chat_id: chatId, text: body, disable_notification: true });
			const id = res?.result?.message_id;
			if (typeof id === "number") bubbleId = id;
		} else {
			await tg("editMessageText", { chat_id: chatId, message_id: bubbleId, text: body });
		}
	}

	pi.on("message_end", (event) => {
		const msg = (event as { message?: { role?: string } }).message;
		if (!msg || msg.role !== "assistant") return undefined;
		const text = stripControlTokens(textOf(msg));
		if (!text) return undefined;
		// Lookahead: commit the PREVIOUS pending into the bubble; hold THIS text back
		// as the candidate final (agent-dispatch sends whatever is still pending).
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
}
