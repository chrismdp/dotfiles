// Automated test for the Telegram interactive progress bubble extension.
// Run: node --experimental-strip-types ~/.pi/agent/extensions/telegram-stream.test.mjs
//
// Mocks globalThis.fetch + a fake `pi`, drives message_end sequences, and asserts:
// intermediate texts accumulate into one silent edited bubble; on process beforeExit
// the final answer replaces that bubble without carrying the working trail; a state
// file tells agent-dispatch whether to skip its fallback final send.

import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --- env the extension reads (set before importing it) ----------------------
process.env.PI_TG_STREAM = "1";
process.env.PI_TG_BOT_VAR = "TESTBOT_TOKEN";
process.env.TESTBOT_TOKEN = "fake-token";
process.env.TELEGRAM_CHAT_ID = "12345";

const { default: ext } = await import("./telegram-stream.ts");

// --- harness ----------------------------------------------------------------
let calls;
let rejectNextEdit = false;
function installFetch() {
	calls = [];
	rejectNextEdit = false;
	let nextId = 100;
	globalThis.fetch = async (url, opts) => {
		const method = String(url).split("/").pop();
		const body = JSON.parse(opts.body);
		calls.push({ method, body });
		if (method === "sendMessage") return { json: async () => ({ ok: true, result: { message_id: nextId++ } }) };
		if (method === "editMessageText" && rejectNextEdit) {
			rejectNextEdit = false;
			return { json: async () => ({ ok: false, description: "synthetic edit failure" }) };
		}
		return { json: async () => ({ ok: true, result: true }) };
	};
}
function fakePi() {
	let handler = null;
	return { on: (ev, h) => { if (ev === "message_end") handler = h; }, fire: (e) => handler(e) };
}
const asst = (text) => ({ message: { role: "assistant", content: [{ type: "text", text }] } });
const toolMsg = () => ({ message: { role: "toolResult", content: [{ type: "text", text: "ignored" }] } });
const thinking = () => ({ message: { role: "assistant", content: [{ type: "thinking", text: "ignored" }] } });
const banned = String.fromCharCode(103, 111, 98, 108, 105, 110);

async function flushBeforeExit() {
	for (const listener of process.listeners("beforeExit")) listener(0);
	await new Promise((resolve) => setTimeout(resolve, 0));
	await new Promise((resolve) => setTimeout(resolve, 0));
}

async function drive(events, opts = {}) {
	installFetch();
	const statePath = path.join(os.tmpdir(), `telegram-stream-test-${process.pid}-${Math.random()}.json`);
	process.env.PI_TG_STREAM_STATE = statePath;
	const before = process.listeners("beforeExit");
	const pi = fakePi();
	const extResult = ext(pi); // fresh closure state per scenario
	for (const e of events) await pi.fire(e);
	if (opts.rejectFinalEdit) rejectNextEdit = true;
	await flushBeforeExit();
	for (const l of process.listeners("beforeExit")) if (!before.includes(l)) process.removeListener("beforeExit", l);
	let state = null;
	if (fs.existsSync(statePath)) state = JSON.parse(fs.readFileSync(statePath, "utf8"));
	fs.rmSync(statePath, { force: true });
	return { calls, state, extResult };
}

// --- assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, fn) {
	try { fn(); console.log(`  ok   ${name}`); pass++; }
	catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

// 1. Three texts → first two are live progress; final edits same bubble cleanly.
{
	const { calls: c, state } = await drive([asst("alpha"), asst("beta"), asst("gamma final")]);
	check("3 texts: send working bubble, edit working bubble, edit final", () => assert.equal(c.length, 3));
	check("3 texts: first is silent HTML sendMessage of text 1", () => {
		assert.equal(c[0].method, "sendMessage");
		assert.equal(c[0].body.disable_notification, true);
		assert.equal(c[0].body.parse_mode, "HTML");
		assert.ok(c[0].body.text.includes("alpha"));
		assert.ok(!c[0].body.text.includes("beta"));
	});
	check("3 texts: second edits quote=alpha + visible latest=beta", () => {
		assert.equal(c[1].method, "editMessageText");
		assert.equal(c[1].body.message_id, 100);
		assert.ok(c[1].body.text.includes("<blockquote expandable>alpha</blockquote>"));
		assert.ok(c[1].body.text.endsWith("beta"));
	});
	check("3 texts: final replaces bubble without trail", () => {
		assert.equal(c[2].method, "editMessageText");
		assert.equal(c[2].body.message_id, 100);
		assert.equal(c[2].body.text, "gamma final");
		assert.ok(!c[2].body.text.includes("alpha"));
		assert.ok(!c[2].body.text.includes("beta"));
		assert.equal(state.final_sent, true);
		assert.equal(state.bubble_id, 100);
		assert.equal(state.mode, "edit");
	});
}

// 2. Single text → one silent send containing the final answer, no second bubble.
{
	const { calls: c, state } = await drive([asst("only answer")]);
	check("1 text: final sent silently by stream extension", () => {
		assert.equal(c.length, 1);
		assert.equal(c[0].method, "sendMessage");
		assert.equal(c[0].body.disable_notification, true);
		assert.equal(c[0].body.text, "only answer");
		assert.equal(state.final_sent, true);
		assert.equal(state.mode, "send");
	});
}

// 3. Two texts → working send, then clean final edit.
{
	const { calls: c, state } = await drive([asst("first"), asst("second final")]);
	check("2 texts: working send + final edit", () => {
		assert.equal(c.length, 2);
		assert.equal(c[0].method, "sendMessage");
		assert.ok(c[0].body.text.includes("first") && !c[0].body.text.includes("second"));
		assert.equal(c[1].method, "editMessageText");
		assert.equal(c[1].body.text, "second final");
		assert.ok(!c[1].body.text.includes("first"));
		assert.equal(state.final_sent, true);
	});
}

// 4. Control tokens stripped: a NO_REPORT-only message is skipped entirely.
{
	const { calls: c } = await drive([asst("NO_REPORT"), asst("real one"), asst("real two")]);
	check("control token skipped: bubble starts at 'real one'", () => {
		assert.equal(c.length, 2); // working send + final edit
		assert.equal(c[0].method, "sendMessage");
		assert.ok(c[0].body.text.includes("real one"));
		assert.ok(!c[0].body.text.includes("NO_REPORT"));
	});
}

// 5. Tool-result and thinking messages are ignored (do not advance the lookahead).
{
	const { calls: c } = await drive([asst("a"), toolMsg(), thinking(), asst("b"), asst("c final")]);
	check("tool/thinking ignored: final is clean c final", () => {
		assert.equal(c.length, 3);
		assert.ok(c[0].body.text.includes("a") && !c[0].body.text.includes("b"));
		assert.ok(c[1].body.text.includes("<blockquote expandable>a</blockquote>"));
		assert.equal(c[2].body.text, "c final");
		assert.ok(!c[2].body.text.includes("<blockquote"));
	});
}

// 6. Empty/whitespace text is skipped (no call, no pending advance).
{
	const { calls: c } = await drive([asst("   "), asst("x"), asst("y final")]);
	check("empty text skipped", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.includes("x"));
		assert.ok(c[1].body.text.startsWith("y final"));
	});
}

// 7. Banned terms are NOT redacted here — language-guard.ts handles them by asking
//    the agent to regenerate, so the bubble renders the (regenerated) text verbatim.
{
	const { calls: c } = await drive([asst(`alpha ${banned}`), asst("beta final")]);
	check("banned term passes through bubble verbatim (retry handled upstream)", () => {
		assert.equal(c.length, 2);
		assert.ok(new RegExp(`\\b${banned}\\b`, "i").test(c[0].body.text));
		assert.ok(!c[0].body.text.includes("the banned term"));
	});
}

// 7b. Vault wikilinks are flattened before send, like send.sh — the extension posts
// straight to Telegram and never passes through send.sh, so without this a reply can
// carry raw [[target]] markup to Chris (2026-09-12 incident: [[2026-W37]] leaked).
{
	const { calls: c, state } = await drive([asst("working [[alpha]] link"), asst("filed in [[2026-W37]] and [[note|label]] here")]);
	check("wikilinks flattened in working bubble and final", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.includes("working alpha link"));
		assert.ok(!c[0].body.text.includes("[["));
		assert.equal(c[1].body.text, "filed in 2026-W37 and label here");
	});
	check("final state records post-sanitisation wikilink count", () => {
		assert.equal(state.sent_wikilinks, 0);
	});
}

// 7c. HTML is escaped before sending via parse_mode=HTML.
{
	const { calls: c } = await drive([asst("alpha <tag> & stuff"), asst("beta final")]);
	check("HTML escaped in bubble", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.includes("alpha &lt;tag&gt; &amp; stuff"));
	});
}

// 7c. Clamp applies to rendered HTML length, not raw text length.
{
	const noisy = "<&>".repeat(2000);
	const { calls: c } = await drive([asst(noisy), asst("beta final")]);
	check("HTML-rendered bubble stays under Telegram limit", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.length <= 3900);
	});
}

// 7d. Oversized final is not truncated; state tells dispatcher to chunk fallback.
{
	const hugeFinal = "F".repeat(4100);
	const { calls: c, state } = await drive([asst("working"), asst(hugeFinal)]);
	check("oversized final: stream leaves dispatcher fallback", () => {
		assert.equal(c.length, 1); // working bubble only; no final edit
		assert.equal(state.final_sent, false);
		assert.equal(state.reason, "too_long");
	});
}

// 7e. Telegram edit rejection leaves dispatcher fallback active.
{
	const { calls: c, state } = await drive([asst("working"), asst("final")], { rejectFinalEdit: true });
	check("edit rejection: state says final not sent", () => {
		assert.equal(c.length, 2);
		assert.equal(c[1].method, "editMessageText");
		assert.equal(state.final_sent, false);
		assert.equal(state.reason, "edit_failed");
	});
}


// 7f. Final answers keep Telegram formatting that the old send.sh path provided.
{
	const { calls: c } = await drive([asst("working"), asst("**bold** *also* _ital_ `code` [link](https://example.com)\n```\n**literal**\n```")]);
	check("final markdown converted on edited bubble", () => {
		const final = c[c.length - 1].body.text;
		assert.ok(final.includes("<b>bold</b>"));
		assert.ok(final.includes("<b>also</b>"));
		assert.ok(final.includes("<i>ital</i>"));
		assert.ok(final.includes("<code>code</code>"));
		assert.ok(final.includes('<a href="https://example.com">link</a>'));
		assert.ok(final.includes("<pre>**literal**\n</pre>"));
	});
}


// 7g. Working trail is not carried into the final edit.
{
	const { calls: c } = await drive([asst("trail **not bold** <x>"), asst("final **bold**")]);
	check("final is formatted and omits trail", () => {
		const final = c[c.length - 1].body.text;
		assert.equal(final, "final <b>bold</b>");
		assert.ok(!final.includes("trail"));
	});
}

// 7h. Internal edit packets are backstage data; never put them in the live bubble.
{
	const packet = `[
  {
    "file_path": "/tmp/post.md",
    "old_string": "Before",
    "new_string": "After",
    "reason": "test"
  }
]`;
	const { calls: c } = await drive([asst("progress line"), asst(packet), asst("final answer")]);
	check("internal edit packet skipped in stream", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.includes("progress line"));
		assert.ok(!c[0].body.text.includes("old_string"));
		assert.equal(c[1].body.text, "final answer");
		assert.ok(!c[1].body.text.includes("progress line"));
		assert.ok(!c[1].body.text.includes("old_string"));
	});
}

// 7i. A NO_REPORT final after working intermediates: the run is silent — the
//     progress bubble is deleted, and state tells the dispatcher to handle silence
//     (reaction/no-send) instead of placing a stale intermediate.
{
	const { calls: c, state } = await drive([asst("working note"), asst("two"), asst("NO_REPORT")]);
	check("NO_REPORT final: bubble deleted, state final_sent false control_token", () => {
		const methods = c.map((x) => x.method);
		// bubble created for first intermediate, then deleted on silent end
		assert.ok(methods.includes("sendMessage"), JSON.stringify(methods));
		assert.ok(methods.includes("deleteMessage"), JSON.stringify(methods));
		assert.equal(state.final_sent, false);
		assert.equal(state.reason, "control_token");
		assert.equal(typeof state.bubble_id, "number");
		assert.equal(state.sent_wikilinks, 0);
	});
}

// 7j. NO_REPORT with NO intermediates: no bubble is ever created, silence holds.
{
	const { calls: c, state } = await drive([asst("NO_REPORT")]);
	check("NO_REPORT alone: no bubble, state final_sent false control_token", () => {
		assert.equal(c.length, 0);
		assert.equal(state.final_sent, false);
		assert.equal(state.reason, "control_token");
	});
}

// 7k. Signal interrupt mid-run: bubble deleted, state marks interrupted so the
//     dispatch retry starts a fresh bubble without a ghost half-thought.
//     Use __testAbandon to avoid fighting signal handlers left by previous tests.
{
	installFetch();
	const before = process.listeners("beforeExit");
	const statePath = path.join(os.tmpdir(), `telegram-stream-test-${process.pid}-sig.json`);
	process.env.PI_TG_STREAM_STATE = statePath;
	const pi = fakePi();
	const fn = ext(pi);
	await pi.fire(asst("first thought"));
	await pi.fire(asst("second thought"));
	// simulate SIGTERM cleanup via the test hook
	await fn.__testAbandon("interrupted");
	await new Promise((resolve) => setTimeout(resolve, 50));
	for (const l of process.listeners("beforeExit")) if (!before.includes(l)) process.removeListener("beforeExit", l);
	let st = null;
	if (fs.existsSync(statePath)) st = JSON.parse(fs.readFileSync(statePath, "utf8"));
	fs.rmSync(statePath, { force: true });
	check("SIGTERM: bubble deleted for interrupt, state reason interrupted", () => {
		const methods = calls.map((x) => x.method);
		assert.ok(methods.includes("deleteMessage"), JSON.stringify(methods));
		assert.equal(st.final_sent, false);
		assert.equal(st.reason, "interrupted");
	});
}

// 8. Interrupt / preempt: Chris sends another turn mid-run. That kills pi #1 and
// starts a fresh pi process (= a fresh ext closure). The new run must open a new
// bubble and never edit the interrupted run's message.
{
	installFetch();
	const before = process.listeners("beforeExit");
	const state1 = path.join(os.tmpdir(), `telegram-stream-test-${process.pid}-a.json`);
	const state2 = path.join(os.tmpdir(), `telegram-stream-test-${process.pid}-b.json`);
	process.env.PI_TG_STREAM_STATE = state1;
	const pi1 = fakePi();
	ext(pi1);
	const pi1BeforeExit = process.listeners("beforeExit").filter((l) => !before.includes(l));
	await pi1.fire(asst("r1-a"));
	await pi1.fire(asst("r1-b")); // run 1 opens bubble msg 100; pending r1-b, then the process is killed
	// Simulate the preempt kill: the first process never gets a graceful beforeExit flush.
	for (const l of pi1BeforeExit) process.removeListener("beforeExit", l);
	process.env.PI_TG_STREAM_STATE = state2;
	const pi2 = fakePi();
	ext(pi2);
	await pi2.fire(asst("r2-a"));
	await pi2.fire(asst("r2-b"));
	await pi2.fire(asst("r2-c"));
	await flushBeforeExit();
	for (const l of process.listeners("beforeExit")) if (!before.includes(l)) process.removeListener("beforeExit", l);
	fs.rmSync(state1, { force: true }); fs.rmSync(state2, { force: true });
	check("interrupt: run 2 opens a NEW bubble, never edits run 1's", () => {
		const sends = calls.filter((c) => c.method === "sendMessage");
		const edits = calls.filter((c) => c.method === "editMessageText");
		assert.equal(sends.length, 2);
		assert.ok(sends[0].body.text.includes("r1-a") && !sends[0].body.text.includes("r2"));
		assert.ok(sends[1].body.text.includes("r2-a"));
		assert.ok(edits.length >= 1 && edits.every((e) => e.body.message_id === 101));
	});
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
