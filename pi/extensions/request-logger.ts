/**
 * Request Logger Extension
 *
 * Logs every outbound provider request payload to disk so we can diff
 * adjacent turns at cache-miss boundaries and find which bytes changed
 * in the prefix.
 *
 * Gated on the `PI_LOG_REQUESTS` env var (a directory path). If unset,
 * the handler is still registered but writes nothing — zero overhead.
 *
 * Output layout:
 *   $PI_LOG_REQUESTS/YYYY-MM-DD/req-HHMMSS-mmm-XXXX.json   pretty-printed payload
 *   $PI_LOG_REQUESTS/YYYY-MM-DD/index.jsonl                one summary line per request
 *
 * The payload value is whatever the provider was about to POST — for the
 * OpenAI-completions providers (DeepSeek/OpenRouter), this is the full
 * `params` object with `model`, `messages`, `tools`, `stream`, etc.
 *
 * Pair with `~/.claude/skills/worker/scripts/request-diff.py` to compute
 * the prefix-divergence point between two requests.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

function ts() {
	const d = new Date();
	const pad = (n: number, w = 2) => String(n).padStart(w, "0");
	return {
		day: `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`,
		time: `${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}-${pad(d.getUTCMilliseconds(), 3)}`,
		iso: d.toISOString(),
	};
}

function rand(): string {
	return Math.random().toString(36).slice(2, 6);
}

function summarise(payload: unknown): Record<string, unknown> {
	const p = payload as {
		model?: string;
		messages?: Array<{ role?: string; content?: unknown }>;
		tools?: unknown[];
		stream?: boolean;
	};
	const messages = Array.isArray(p?.messages) ? p.messages : [];
	let totalChars = 0;
	const roleCounts: Record<string, number> = {};
	for (const m of messages) {
		const role = m?.role ?? "?";
		roleCounts[role] = (roleCounts[role] ?? 0) + 1;
		const c = m?.content;
		if (typeof c === "string") totalChars += c.length;
		else if (Array.isArray(c)) {
			for (const b of c) {
				const bb = b as { text?: string; content?: string };
				if (typeof bb?.text === "string") totalChars += bb.text.length;
				if (typeof bb?.content === "string") totalChars += bb.content.length;
			}
		}
	}
	return {
		model: p?.model,
		stream: p?.stream,
		message_count: messages.length,
		role_counts: roleCounts,
		total_content_chars: totalChars,
		tool_count: Array.isArray(p?.tools) ? p.tools.length : 0,
	};
}

export default function (pi: ExtensionAPI) {
	pi.on("before_provider_request", async (event) => {
		const dir = process.env.PI_LOG_REQUESTS;
		if (!dir) return event.payload; // gated off — pass through unchanged

		try {
			const { day, time, iso } = ts();
			const dayDir = join(dir, day);
			mkdirSync(dayDir, { recursive: true });
			const name = `req-${time}-${rand()}.json`;
			const path = join(dayDir, name);
			writeFileSync(path, JSON.stringify(event.payload, null, 2));
			const index = {
				ts: iso,
				file: name,
				...summarise(event.payload),
			};
			appendFileSync(join(dayDir, "index.jsonl"), `${JSON.stringify(index)}\n`);
		} catch (err) {
			// Never break the request. Surface to stderr only.
			process.stderr.write(`[request-logger] write failed: ${(err as Error).message}\n`);
		}

		return event.payload;
	});
}
