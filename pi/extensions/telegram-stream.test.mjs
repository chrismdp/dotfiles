// Automated test for the thought-bubble streaming extension (telegram-stream.ts).
// Run: node --experimental-strip-types ~/.pi/agent/extensions/telegram-stream.test.mjs
//
// Mocks globalThis.fetch + a fake `pi`, drives message_end sequences, and asserts the
// lookahead behaviour: the LAST assistant text is held back (sent by agent-dispatch,
// not here); intermediate texts accumulate into ONE silent bubble (sendMessage with
// disable_notification, then editMessageText in place); control tokens and non-text /
// non-assistant messages are skipped. Named .mjs (not .ts) so pi's loader ignores it.

import assert from "node:assert";

// --- env the extension reads (set before importing it) ----------------------
process.env.PI_TG_STREAM = "1";
process.env.PI_TG_BOT_VAR = "TESTBOT_TOKEN";
process.env.TESTBOT_TOKEN = "fake-token";
process.env.TELEGRAM_CHAT_ID = "12345";

const { default: ext } = await import("./telegram-stream.ts");

// --- harness ----------------------------------------------------------------
let calls;
function installFetch() {
	calls = [];
	let nextId = 100;
	globalThis.fetch = async (url, opts) => {
		const method = String(url).split("/").pop();
		const body = JSON.parse(opts.body);
		calls.push({ method, body });
		if (method === "sendMessage") return { json: async () => ({ ok: true, result: { message_id: nextId++ } }) };
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

async function drive(events) {
	installFetch();
	const pi = fakePi();
	ext(pi); // fresh closure state per scenario
	for (const e of events) await pi.fire(e);
	return calls;
}

// --- assertions -------------------------------------------------------------
let pass = 0, fail = 0;
function check(name, fn) {
	try { fn(); console.log(`  ok   ${name}`); pass++; }
	catch (e) { console.log(`  FAIL ${name}: ${e.message}`); fail++; }
}

// 1. Three texts → bubble holds 1..2 (send + edit), text 3 held back.
//    Older committed text sits in an expandable quote; latest committed text stays visible.
//    No extra label above the quote — the quote bar is enough UI.
{
	const c = await drive([asst("alpha"), asst("beta"), asst("gamma")]);
	check("3 texts: 2 bubble calls, last held", () => assert.equal(c.length, 2));
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
		assert.equal(c[1].body.parse_mode, "HTML");
		assert.ok(c[1].body.text.includes("<blockquote expandable>alpha</blockquote>"));
		assert.ok(c[1].body.text.endsWith("beta"));
		assert.ok(!c[1].body.text.includes("gamma")); // last text never committed
	});
}

// 2. Single text → no bubble at all (agent-dispatch sends it as the final).
{
	const c = await drive([asst("only answer")]);
	check("1 text: zero Telegram calls (no bubble)", () => assert.equal(c.length, 0));
}

// 3. Two texts → exactly one silent sendMessage (text 1), text 2 held.
{
	const c = await drive([asst("first"), asst("second")]);
	check("2 texts: one HTML sendMessage, no edit, last held", () => {
		assert.equal(c.length, 1);
		assert.equal(c[0].method, "sendMessage");
		assert.equal(c[0].body.parse_mode, "HTML");
		assert.ok(c[0].body.text.includes("first") && !c[0].body.text.includes("second"));
	});
}

// 4. Control tokens stripped: a NO_REPORT-only message is skipped entirely.
{
	const c = await drive([asst("NO_REPORT"), asst("real one"), asst("real two")]);
	check("control token skipped: bubble starts at 'real one'", () => {
		assert.equal(c.length, 1); // commit('real one') only; 'real two' held; NO_REPORT skipped
		assert.equal(c[0].method, "sendMessage");
		assert.ok(c[0].body.text.includes("real one"));
		assert.ok(!c[0].body.text.includes("NO_REPORT"));
	});
}

// 5. Tool-result and thinking messages are ignored (don't advance the lookahead).
{
	const c = await drive([asst("a"), toolMsg(), thinking(), asst("b"), asst("c")]);
	check("tool/thinking ignored: quote=a, visible latest=b, c held", () => {
		assert.equal(c.length, 2);
		assert.ok(c[0].body.text.includes("a") && !c[0].body.text.includes("b"));
		assert.ok(c[1].body.text.includes("<blockquote expandable>a</blockquote>"));
		assert.ok(c[1].body.text.endsWith("b"));
		assert.ok(!c[1].body.text.endsWith("c"));
	});
}

// 6. Empty/whitespace text is skipped (no call, no pending advance).
{
	const c = await drive([asst("   "), asst("x"), asst("y")]);
	check("empty text skipped", () => {
		assert.equal(c.length, 1);
		assert.ok(c[0].body.text.includes("x"));
	});
}

// 7. Banned user-facing terms are paraphrased before the silent bubble is sent.
{
	const c = await drive([asst("alpha goblin"), asst("beta")]);
	check("banned user term paraphrased in bubble", () => {
		assert.equal(c.length, 1);
		assert.ok(c[0].body.text.includes("the banned term"));
		assert.ok(!/\bgoblins?\b/i.test(c[0].body.text));
	});
}

// 7b. HTML is escaped before sending via parse_mode=HTML.
{
	const c = await drive([asst("alpha <tag> & stuff"), asst("beta")]);
	check("HTML escaped in bubble", () => {
		assert.equal(c.length, 1);
		assert.ok(c[0].body.text.includes("alpha &lt;tag&gt; &amp; stuff"));
	});
}

// 7c. Clamp applies to rendered HTML length, not raw text length.
{
	const noisy = "<&>".repeat(2000);
	const c = await drive([asst(noisy), asst("beta")]);
	check("HTML-rendered bubble stays under Telegram limit", () => {
		assert.equal(c.length, 1);
		assert.ok(c[0].body.text.length <= 3900);
	});
}

// 8. Interrupt / preempt: Chris sends another turn mid-run. That kills pi #1 and
//    starts a FRESH pi process (= a fresh ext closure). The new run must open a NEW
//    bubble and never edit the interrupted run's message. Modelled as two ext() calls
//    sharing one fetch log (two processes, one chat).
{
	installFetch();
	const pi1 = fakePi();
	ext(pi1); // run 1 (the one that gets interrupted)
	await pi1.fire(asst("r1-a"));
	await pi1.fire(asst("r1-b")); // run 1 opens bubble msg 100 (commits r1-a); r1-b pending, then killed
	const pi2 = fakePi();
	ext(pi2); // <-- the interrupt: a brand-new process/closure
	await pi2.fire(asst("r2-a"));
	await pi2.fire(asst("r2-b"));
	await pi2.fire(asst("r2-c")); // run 2: opens bubble msg 101 (r2-a), edits it (r2-a+b); r2-c held
	check("interrupt: run 2 opens a NEW bubble, never edits run 1's", () => {
		const sends = calls.filter((c) => c.method === "sendMessage");
		const edits = calls.filter((c) => c.method === "editMessageText");
		assert.equal(sends.length, 2); // two distinct bubbles, one per run
		assert.ok(sends[0].body.text.includes("r1-a") && !sends[0].body.text.includes("r2"));
		assert.ok(sends[1].body.text.includes("r2-a")); // run 2's fresh bubble
		assert.ok(edits.length >= 1 && edits.every((e) => e.body.message_id === 101)); // edits hit run 2's id, never 100
	});
}

console.log(`\nRESULT: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
