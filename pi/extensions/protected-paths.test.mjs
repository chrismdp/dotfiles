// Behaviour tests for protected-paths.ts. Run:
// node --experimental-strip-types ~/.pi/agent/extensions/protected-paths.test.mjs

import assert from "node:assert";

const { default: ext, bashCreatesReference, isReferencePath } = await import("./protected-paths.ts");

assert.strictEqual(isReferencePath("/home/cp/vault/links/reference/source.md"), true);
assert.strictEqual(isReferencePath("links/reference/source.md"), true);
assert.strictEqual(isReferencePath("/home/cp/vault/links/references.md"), false);

for (const command of [
	"cat /tmp/source.md > /home/cp/vault/links/reference/source.md",
	"curl https://example.com | tee ~/vault/links/reference/source.md",
	"cp /tmp/source.md /home/cp/vault/links/reference/source.md",
	"mv /tmp/source.md /home/cp/vault/links/reference/source.md",
	"touch /home/cp/vault/links/reference/source.md",
	"python3 - <<'PY'\nfrom pathlib import Path\nPath('/home/cp/vault/links/reference/source.md').write_text('x')\nPY",
	"python3 -c \"open('/home/cp/vault/links/reference/source.md', 'w').write('x')\"",
	"mv /tmp/bulk-dir /home/cp/vault/links/reference/target/",
]) {
	assert.strictEqual(bashCreatesReference(command), true, `blocks shell creation: ${command}`);
}

for (const command of [
	"rg -n foo /home/cp/vault/links/reference/",
	"cp /home/cp/vault/links/reference/source.md /tmp/source.md",
	"mv /home/cp/vault/links/reference/cc-essay-clean.md /home/cp/vault/links/reference/it-was-just-a-game-of-catch.md",
	"mv \"/home/cp/vault/links/reference/cc-essay-clean.md\" \"/home/cp/vault/links/reference/it-was-just-a-game-of-catch.md\"",
	"mv /home/cp/vault/links/reference/cc-essay-clean.md /home/cp/vault/links/reference/assets/cc-essay-clean.txt && mv /home/cp/vault/links/reference/x.md /home/cp/vault/links/reference/y.md && echo DONE",
	"cp /home/cp/vault/links/reference/a.md /home/cp/vault/links/reference/b.md",
	"python3 - <<'PY'\nimport os, shutil\nbase = '/home/cp/vault/links/reference'\nos.rename(f'{base}/cc-essay-clean.md', f'{base}/it-was-just-a-game-of-catch.md')\nprint('ok')\nPY",
	"python3 -c \"from pathlib import Path; print(Path('/home/cp/vault/links/reference/source.md').read_text())\"",
	"~/.pi/agent/skills/process-link/scripts/save-article.sh https://example.com --source test",
]) {
	assert.strictEqual(bashCreatesReference(command), false, `allows read, rename or saver: ${command}`);
}

function fakePi() {
	let handler = null;
	return {
		on: (event, callback) => {
			if (event === "tool_call") handler = callback;
		},
		fire: (event, ctx = { hasUI: false }) => handler(event, ctx),
	};
}

const pi = fakePi();
ext(pi);

let result = await pi.fire({
	toolName: "write",
	input: { path: "/home/cp/vault/links/reference/source.md", content: "x" },
});
assert.strictEqual(result?.block, true, "direct write is blocked outright");
assert.match(result.reason, /save-article\.sh/);

result = await pi.fire({
	toolName: "edit",
	input: {
		path: "/home/cp/vault/links/reference/source.md",
		edits: [{ oldText: "status: to-read", newText: "status: processed" }],
	},
});
assert.strictEqual(result, undefined, "normal process-link metadata edit remains allowed");

result = await pi.fire({
	toolName: "bash",
	input: {
		command: "python3 - <<'PY'\nfrom pathlib import Path\nPath('/home/cp/vault/links/reference/source.md').write_text('x')\nPY",
	},
});
assert.strictEqual(result?.block, true, "Python write inside Bash is blocked");

result = await pi.fire({
	toolName: "bash",
	input: { command: "rg -n foo /home/cp/vault/links/reference/" },
});
assert.strictEqual(result, undefined, "read-only shell inspection remains allowed");

console.log("protected-paths tests passed");
