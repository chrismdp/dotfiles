// Automated test for the language-guard banned-word RETRY extension.
// Run: node --experimental-strip-types ~/.pi/agent/extensions/language-guard.test.mjs
//
// Mocks a fake `pi` (capturing sendUserMessage calls + the message_end handler) and
// asserts: a banned assistant message triggers exactly one regeneration follow-up
// naming the term; a clean message triggers none; retries are capped; a user message
// is ignored; and the case rule (Tiny vs tiny) holds.

import assert from "node:assert";

const { default: ext, bannedTermsIn } = await import("./language-guard.ts");

// --- harness ----------------------------------------------------------------
function makePi() {
	const calls = [];
	let handler;
	const pi = {
		on: (evt, fn) => { if (evt === "message_end") handler = fn; },
		sendUserMessage: (content, options) => { calls.push({ content, options }); return Promise.resolve(); },
	};
	ext(pi);
	return { pi, calls, fire: (message) => handler({ message }) };
}

const asst = (text) => ({ role: "assistant", content: [{ type: "text", text }] });
const user = (text) => ({ role: "user", content: [{ type: "text", text }] });

let passed = 0, failed = 0;
async function check(name, fn) {
	try { await fn(); console.log(`  ok   ${name}`); passed++; }
	catch (e) { console.log(`  FAIL ${name}\n       ${e.message}`); failed++; }
}

// --- pure detector ----------------------------------------------------------
await check("bannedTermsIn: gremlin + plural goblins detected", () => {
	assert.deepEqual(bannedTermsIn("a gremlin and two goblins"), ["goblin", "gremlin"]);
});
await check("bannedTermsIn: capitalised Tiny detected, lowercase tiny ignored", () => {
	assert.deepEqual(bannedTermsIn("Tiny win"), ["Tiny"]);
	assert.deepEqual(bannedTermsIn("keep tiny replies plain"), []);
});
await check("bannedTermsIn: clean text → none", () => {
	assert.deepEqual(bannedTermsIn("a perfectly ordinary sentence"), []);
});

// --- retry behaviour --------------------------------------------------------
await check("banned assistant message → one follow-up naming the term", async () => {
	const { calls, fire } = makePi();
	await fire(asst("Here is a gremlin joke."));
	assert.equal(calls.length, 1);
	assert.equal(calls[0].options.deliverAs, "followUp");
	assert.ok(calls[0].content.includes('"gremlin"'), "note should name the term");
	assert.ok(/NOT from Chris/i.test(calls[0].content), "note should mark itself internal");
});

await check("clean assistant message → no follow-up", async () => {
	const { calls, fire } = makePi();
	await fire(asst("A clean, ordinary answer."));
	assert.equal(calls.length, 0);
});

await check("user message is ignored", async () => {
	const { calls, fire } = makePi();
	await fire(user("a gremlin appears"));
	assert.equal(calls.length, 0);
});

await check("retries capped (MAX_RETRIES=2): 4 banned msgs → only 2 nudges", async () => {
	const { calls, fire } = makePi();
	for (let i = 0; i < 4; i++) await fire(asst("still a gremlin here"));
	assert.equal(calls.length, 2, `expected 2 nudges, got ${calls.length}`);
});

await check("capitalised-only: 'Tiny' nudges, 'tiny' does not", async () => {
	const a = makePi();
	await a.fire(asst("Tiny improvement shipped"));
	assert.equal(a.calls.length, 1);
	const b = makePi();
	await b.fire(asst("keep tiny replies plain"));
	assert.equal(b.calls.length, 0);
});

// tool-call turns are mid-work narration, not the final reply — skip them so a banned
// word in narration doesn't burn the retry budget meant for the user-facing answer.
const asstTool = (text) => ({
	role: "assistant",
	content: [{ type: "text", text }, { type: "toolCall", id: "t1", name: "read", arguments: {} }],
});
await check("tool-call turn with a banned word is skipped (no follow-up)", async () => {
	const { calls, fire } = makePi();
	await fire(asstTool("Let me check that gremlin file."));
	assert.equal(calls.length, 0);
});
await check("tool-call turn doesn't burn budget; later text reply still retried", async () => {
	const { calls, fire } = makePi();
	await fire(asstTool("inspecting the gremlin config"));
	await fire(asst("done — the gremlin is gone"));
	assert.equal(calls.length, 1); // only the text-only final triggered a retry
});

console.log(`\nRESULT: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
