// Automated test for bash-guard.ts, focused on the attendee-aware calendar
// deletion logic. Run: node --experimental-strip-types ~/.pi/agent/extensions/bash-guard.test.mjs
//
// Mocks runGog (no real gog calls) and a fake pi/ctx, then asserts:
// solo events delete silently, shared events block outright, unparseable or
// unfetchable cases fall back to ASK (block when headless), and compound
// commands still trip the other ask patterns. Named .mjs so pi's loader
// ignores it.

import assert from "node:assert";

const {
  default: ext,
  extractCalDeleteTargets,
  classifyCalendarEvent,
  _setRunGogForTests,
} = await import("./bash-guard.ts");

// --- extraction ---------------------------------------------------------------

assert.deepStrictEqual(
  extractCalDeleteTargets("gog calendar delete chris.p@rsons.org abc123"),
  [{ calendarId: "chris.p@rsons.org", eventId: "abc123" }],
  "simple gog delete",
);

assert.deepStrictEqual(
  extractCalDeleteTargets("gog cal rm c_bfa67387@group.calendar.google.com ev9 --json"),
  [{ calendarId: "c_bfa67387@group.calendar.google.com", eventId: "ev9" }],
  "alias verbs and trailing flag",
);

assert.deepStrictEqual(
  extractCalDeleteTargets("gog calendar delete --force --account=cp@cherrypick.co calX evY"),
  [{ calendarId: "calX", eventId: "evY" }],
  "leading flags skipped",
);

assert.deepStrictEqual(
  extractCalDeleteTargets(
    `gws calendar events delete --params '{"calendarId": "chris.p@rsons.org", "eventId": "ev42"}'`,
  ),
  [{ calendarId: "chris.p@rsons.org", eventId: "ev42" }],
  "gws params form",
);

assert.deepStrictEqual(
  extractCalDeleteTargets("gog calendar delete a e1 && gog calendar delete a e2"),
  [
    { calendarId: "a", eventId: "e1" },
    { calendarId: "a", eventId: "e2" },
  ],
  "two gog deletes both extracted",
);

assert.strictEqual(
  extractCalDeleteTargets("for id in $IDS; do gog calendar delete; done"),
  null,
  "delete verb with no parseable args returns null",
);

assert.strictEqual(
  extractCalDeleteTargets("gws calendar events delete; gws calendar events delete"),
  null,
  "multiple gws deletes can't be paired",
);

assert.deepStrictEqual(extractCalDeleteTargets("gog calendar events chris.p@rsons.org"), [], "non-delete command");

// --- classification -----------------------------------------------------------

const eventJson = (attendees) => JSON.stringify({ event: { summary: "Test event", attendees } });

_setRunGogForTests(() => eventJson(undefined));
assert.strictEqual(classifyCalendarEvent("c", "e").verdict, "solo", "no attendees → solo");

_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true, organizer: true }]));
assert.strictEqual(classifyCalendarEvent("c", "e").verdict, "solo", "self-only → solo");

_setRunGogForTests(() =>
  eventJson([{ email: "chris.p@rsons.org", self: true }, { email: "CP@cherrypick.co" }]),
);
assert.strictEqual(classifyCalendarEvent("c", "e").verdict, "solo", "own emails (case-insensitive) → solo");

_setRunGogForTests(() =>
  eventJson([{ email: "chris.p@rsons.org", self: true }, { email: "bobby.gilbert66@gmail.com" }]),
);
const shared = classifyCalendarEvent("c", "e");
assert.strictEqual(shared.verdict, "shared", "external attendee → shared");
assert.ok(shared.detail.includes("bobby.gilbert66@gmail.com"), "detail names the other attendee");

_setRunGogForTests(() => {
  throw new Error("event not found");
});
assert.strictEqual(classifyCalendarEvent("c", "e").verdict, "unknown", "fetch failure → unknown");

// --- handler ------------------------------------------------------------------

function fakePi() {
  let handler = null;
  return {
    on: (ev, h) => {
      if (ev === "tool_call") handler = h;
    },
    fire: (e, ctx) => handler(e, ctx),
  };
}
const bash = (command) => ({ toolName: "bash", input: { command } });
const headless = { hasUI: false };
const tty = (answer) => ({ hasUI: true, ui: { select: async () => answer } });

const pi = fakePi();
ext(pi);

// solo event: delete runs with no prompt, even headless
_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }]));
assert.strictEqual(
  await pi.fire(bash("gog calendar delete chris.p@rsons.org ev1 --force"), headless),
  undefined,
  "solo delete allowed headless",
);

// shared event: blocked outright, even in TTY (no ask)
_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }, { email: "x@ext.com" }]));
let res = await pi.fire(bash("gog calendar delete chris.p@rsons.org ev2"), tty("Yes — let it run"));
assert.strictEqual(res?.block, true, "shared delete blocked even when TTY would approve");
assert.ok(res.reason.includes("x@ext.com"), "block reason names attendee");

// unfetchable event: falls back to ASK → blocked headless, allowed if TTY approves
_setRunGogForTests(() => {
  throw new Error("not found");
});
res = await pi.fire(bash("gog calendar delete chris.p@rsons.org gone1"), headless);
assert.strictEqual(res?.block, true, "unknown event blocked headless");
res = await pi.fire(bash("gog calendar delete chris.p@rsons.org gone1"), tty("Yes — let it run"));
assert.strictEqual(res, undefined, "unknown event allowed after TTY approval");

// unparseable delete: ASK fallback
res = await pi.fire(bash("for id in $IDS; do gog calendar delete; done"), headless);
assert.strictEqual(res?.block, true, "unparseable delete blocked headless");

// compound command: solo delete must NOT bypass other ask patterns (git push)
_setRunGogForTests(() => eventJson(undefined));
res = await pi.fire(bash("gog calendar delete c ev3 && git push"), headless);
assert.strictEqual(res?.block, true, "solo delete + git push still blocked headless");

// non-calendar commands unaffected
assert.strictEqual(await pi.fire(bash("ls -la"), headless), undefined, "benign command passes");
res = await pi.fire(bash("rm -rf /tmp/x"), tty("Yes — let it run"));
assert.strictEqual(res?.block, true, "destructive rm still hard-blocked");

console.log("bash-guard tests passed");
