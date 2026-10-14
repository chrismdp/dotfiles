/**
 * Turn timer — right-justified on a dim line above the editor, after one
 * blank line of space.
 *
 *   - While pi works:  "⧗ 1m 12s"                          (live)
 *   - While idle:      "⧗ finished 14:32 · took 3m 12s"    (stays until next run)
 *
 * Clock semantics: starts on the first agent_start of a run; stops only on
 * agent_settled when the session is idle. A settled handler in another
 * extension can start more work before ours runs.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_ID = "turn-timer";

export default function (pi: ExtensionAPI) {
	let startedAt: number | undefined;
	let finishedAt: number | undefined;
	let lastDurationMs: number | undefined;
	let tick: ReturnType<typeof setInterval> | undefined;
	let requestRender: (() => void) | undefined;

	const fmtClock = (ts: number): string => {
		const d = new Date(ts);
		return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
	};

	const fmtDuration = (ms: number): string => {
		const s = Math.floor(ms / 1000);
		if (s < 60) return `${s}s`;
		const m = Math.floor(s / 60);
		if (m < 60) return `${m}m ${s % 60}s`;
		return `${Math.floor(m / 60)}h ${m % 60}m`;
	};

	const timerText = (): string =>
		startedAt !== undefined
			? `⧗ ${fmtDuration(Date.now() - startedAt)}`
			: finishedAt !== undefined && lastDurationMs !== undefined
				? `⧗ finished ${fmtClock(finishedAt)} · took ${fmtDuration(lastDurationMs)}`
				: "";

	const stopTick = () => {
		if (tick !== undefined) {
			clearInterval(tick);
			tick = undefined;
		}
	};

	/** Pi adds the blank line before the above-editor widgets. */
	const lines = (width: number): string[] => {
		const text = timerText();
		if (!text) return [];
		const clipped = truncateToWidth(text, width, "");
		const pad = Math.max(0, width - visibleWidth(clipped));
		return [" ".repeat(pad) + clipped];
	};

	const setWidget = (ctx: import("@earendil-works/pi-coding-agent").ExtensionContext) => {
		ctx.ui.setWidget(
			WIDGET_ID,
			(_tui, theme) => {
				requestRender = () => _tui.requestRender();
				return {
					render: (width: number) =>
						lines(width).map((l) => theme.fg("dim", l)),
					invalidate: () => {},
				};
			},
			{ placement: "aboveEditor" },
		);
	};

	pi.on("session_start", async (_event, ctx) => {
		startedAt = undefined;
		finishedAt = undefined;
		lastDurationMs = undefined;
		stopTick();
		requestRender = undefined;
		if (ctx.hasUI) {
			setWidget(ctx);
		}
	});

	pi.on("session_shutdown", async () => {
		stopTick();
		requestRender = undefined;
	});

	pi.on("agent_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		if (startedAt !== undefined) return; // retry / follow-up within the same run
		startedAt = Date.now();
		setWidget(ctx);
		stopTick();
		tick = setInterval(() => requestRender?.(), 1000);
	});

	pi.on("agent_settled", async (_event, ctx) => {
		if (!ctx.isIdle()) return;
		stopTick();
		if (startedAt !== undefined) {
			finishedAt = Date.now();
			lastDurationMs = finishedAt - startedAt;
			startedAt = undefined;
		}
		if (ctx.hasUI) setWidget(ctx);
	});
}
