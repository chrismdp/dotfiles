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
  extractCalUpdateTargets,
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

assert.deepStrictEqual(
  extractCalUpdateTargets("gog calendar update primary ev1 --summary 'Focus block' --force --no-input"),
  [{ calendarId: "primary", eventId: "ev1" }],
  "simple gog update target",
);

assert.deepStrictEqual(
  extractCalUpdateTargets("gog cal update --account cp@cherrypick.co primary ev1 --from 2026-06-14T09:00:00Z"),
  [{ calendarId: "primary", eventId: "ev1" }],
  "update skips leading flag with separate value",
);

assert.strictEqual(
  extractCalUpdateTargets("u=up''date; gog calendar $u primary ev1"),
  null,
  "dynamic update command is not treated as parseable safe calendar update",
);

// --- classification -----------------------------------------------------------

const eventJson = (attendees, extra = {}) => JSON.stringify({ event: { summary: "Test event", attendees, ...extra } });

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

_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }], { organizer: { email: "x@ext.com" } }));
const externalOrganizer = classifyCalendarEvent("c", "e");
assert.strictEqual(externalOrganizer.verdict, "shared", "external organiser → shared/invited");
assert.ok(externalOrganizer.detail.includes("x@ext.com"), "detail names the organiser");

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

// solo own-calendar updates are permitted headless when they do not add attendees or notify guests
_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }]));
assert.strictEqual(
  await pi.fire(bash("gog calendar update primary ev1 --summary 'Bella: focus' --force --no-input"), headless),
  undefined,
  "solo update allowed headless",
);

// Miriam bug report: help, dry-run, and quoted search terms must not trip the guard
assert.strictEqual(
  await pi.fire(bash("gog calendar update --help"), headless),
  undefined,
  "calendar update help allowed headless",
);
assert.strictEqual(
  await pi.fire(bash("gog calendar update primary ev1 --summary test --dry-run"), headless),
  undefined,
  "calendar update dry-run allowed headless",
);
assert.strictEqual(
  await pi.fire(bash(`rg -n "calendar update|events.patch" /home/cp/code/gogcli`), headless),
  undefined,
  "rg search containing guarded words allowed headless",
);
assert.strictEqual(
  await pi.fire(
    bash(`~/.claude/skills/telegram/scripts/agent-route.sh --to miriam --label "guard note" "gog calendar update primary ev1"`),
    headless,
  ),
  undefined,
  "quoted routed prose mentioning guarded commands is allowed",
);

// invited/shared events and external notifications remain protected
_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }, { email: "x@ext.com" }]));
res = await pi.fire(bash("gog calendar update primary ev2 --summary nope"), headless);
assert.strictEqual(res?.block, true, "shared update blocked headless");
assert.ok(res.reason.includes("x@ext.com"), "shared update reason names attendee");

_setRunGogForTests(() => eventJson([{ email: "chris.p@rsons.org", self: true }]));
res = await pi.fire(bash("gog calendar update primary ev3 --add-attendee x@ext.com"), headless);
assert.strictEqual(res?.block, true, "adding attendee blocked headless");
res = await pi.fire(bash("gog calendar update primary ev3 --send-updates all"), headless);
assert.strictEqual(res?.block, true, "external notifications blocked headless");
res = await pi.fire(bash(`bash -c "gog calendar update primary ev3 --add-attendee x@ext.com"`), headless);
assert.strictEqual(res?.block, true, "bash -c quoted mutating command is still inspected and blocked");

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

// evidence logs are readable but protected against tool-side tampering
assert.strictEqual(
  await pi.fire(bash("tail -n 20 /tmp/agent-dispatch.jsonl"), headless),
  undefined,
  "evidence log read allowed",
);
assert.strictEqual(
  await pi.fire(bash("rg -n richard /tmp/agent-dispatch.jsonl"), headless),
  undefined,
  "evidence log search allowed",
);
res = await pi.fire(bash("echo '{}' >> /tmp/agent-dispatch.jsonl"), headless);
assert.strictEqual(res?.block, true, "append to dispatch evidence blocked");
res = await pi.fire(bash("bash -c \"echo hi > /tmp/agent-stalls.jsonl\""), headless);
assert.strictEqual(res?.block, true, "nested overwrite to stall evidence blocked");
res = await pi.fire(bash("truncate -s 0 ~/.pi/agent/sessions/x/y.jsonl"), headless);
assert.strictEqual(res?.block, true, "session transcript truncate blocked");
res = await pi.fire(bash("rm ~/.pi/cost/2026-07-09.jsonl"), headless);
assert.strictEqual(res?.block, true, "cost log rm blocked");
res = await pi.fire(bash("printf x | tee /tmp/telegram-send-audit.jsonl"), headless);
assert.strictEqual(res?.block, true, "send audit tee blocked");
res = await pi.fire(bash(`~/.claude/skills/telegram/scripts/agent-route.sh --to bella --label "note" "tail /tmp/agent-dispatch.jsonl; do not edit it"`), headless);
assert.strictEqual(res, undefined, "quoted route prose mentioning evidence logs is allowed");

// non-calendar commands unaffected
assert.strictEqual(await pi.fire(bash("ls -la"), headless), undefined, "benign command passes");
res = await pi.fire(bash("rm -rf /tmp/x"), tty("Yes — let it run"));
assert.strictEqual(res?.block, true, "destructive rm still hard-blocked");

console.log("bash-guard tests passed");
