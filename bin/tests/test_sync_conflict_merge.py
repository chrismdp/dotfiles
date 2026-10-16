"""Behaviour tests for the Syncthing conflict resolver.

Each test builds a throwaway git repo standing in for the vault, drops a
Syncthing conflict copy into it, runs the script as cron would, and checks
what is left on disk. The model is always a fake named by SYNC_MERGE_CMD, and
HOME points at a temp dir, so nothing here can reach the real vault, the real
state dir or the real `claude`.
"""

import os
import subprocess
import sys
import textwrap
import time
from pathlib import Path

import pytest

BIN = Path(__file__).resolve().parents[1]
SCRIPT = BIN / "sync-conflict-merge"
VAULT_SYNC = BIN / "vault-sync.sh"

STAMP = "20261014-153012-ABCDEF7"

BASE = "# Note\n\nline one\nline two\nline three\nline four\nline five\n"
NUMBERED = "".join(f"line {n:02d}\n" for n in range(1, 41))


def conflict_name(original):
    """Where Syncthing puts the losing copy of `original`.

    Syncthing splits on Go's filepath.Ext: everything from the last dot, so
    `.gitignore` is all extension and `README` has none.
    """
    path = Path(original)
    dot = path.name.rfind(".")
    stem, ext = (path.name[:dot], path.name[dot:]) if dot >= 0 else (path.name, "")
    return str(path.with_name(f"{stem}.sync-conflict-{STAMP}{ext}"))


@pytest.fixture
def home(tmp_path):
    path = tmp_path / "home"
    path.mkdir()
    return path


@pytest.fixture
def env(tmp_path, home):
    return {
        **{k: v for k, v in os.environ.items() if not k.startswith("SYNC_")},
        "HOME": str(home),
        "GIT_CONFIG_GLOBAL": "/dev/null",
        "GIT_CONFIG_NOSYSTEM": "1",
        "SYNC_CONFLICT_STATE_DIR": str(tmp_path / "state"),
    }


def git(repo, *args, env):
    return subprocess.run(["git", "-C", str(repo), *args], env=env,
                          check=True, capture_output=True, text=True).stdout


@pytest.fixture
def vault(home, env):
    path = home / "vault"
    path.mkdir()
    git(path, "init", "-q", "-b", "main", env=env)
    git(path, "config", "user.name", "Test", env=env)
    git(path, "config", "user.email", "chris+test@chrismdp.com", env=env)
    return path


def commit(vault, files, env):
    """Commit `files` and return the new commit's sha."""
    for name, content in files.items():
        write(vault, name, content)
    git(vault, "add", "-A", env=env)
    git(vault, "commit", "-q", "-m", "vault backup", env=env)
    return git(vault, "rev-parse", "HEAD", env=env).strip()


def write(vault, name, content):
    target = vault / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        target.write_bytes(content)
    else:
        target.write_text(content)
    return target


def resolutions(*bodies):
    """A well-formed model reply resolving each conflict with `bodies` in order."""
    return "".join(f"<resolution {n}>\n{body}</resolution {n}>\n"
                   for n, body in enumerate(bodies, 1))


class FakeModel:
    """Stands in for `claude -p`: records what it was sent, replies on cue."""

    def __init__(self, root):
        self.root = root
        self.calls = root / "calls"
        self.calls.mkdir(parents=True)
        self.script = root / "fake-merge.py"
        self.reply("no reply was set up for this test\n")

    def reply(self, text, exit_code=0, sleep=0):
        self.script.write_text(textwrap.dedent(f"""\
            import sys, time
            from pathlib import Path
            calls = Path({str(self.calls)!r})
            n = len(list(calls.iterdir()))
            (calls / f"{{n}}.stdin").write_text(sys.stdin.read())
            (calls / f"{{n}}.argv").write_text("\\0".join(sys.argv[1:]))
            time.sleep({sleep})
            sys.stdout.write({text!r})
            sys.exit({exit_code})
        """))

    @property
    def command(self):
        return f"{sys.executable} {self.script}"

    def prompts(self):
        return [p.read_text() for p in sorted(self.calls.glob("*.stdin"))]


@pytest.fixture
def model(tmp_path):
    return FakeModel(tmp_path / "model")


def run(vault, env, model=None, **extra):
    if model is not None:
        extra.setdefault("SYNC_MERGE_CMD", model.command)
    result = subprocess.run([str(SCRIPT), str(vault)], env={**env, **extra},
                            capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr
    return result


def saved(env):
    root = Path(env["SYNC_CONFLICT_STATE_DIR"])
    return {str(p.relative_to(run_dir)): p.read_text()
            for run_dir in root.iterdir() for p in run_dir.rglob("*") if p.is_file()}


class TestMergedWithoutTheModel:
    def test_edits_to_different_lines_merge_cleanly(self, vault, env, model):
        base = commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md", BASE.replace("line one", "laptop edit"))
        write(vault, conflict_name("Note.md"), BASE.replace("line five", "phone edit"))

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == (
            BASE.replace("line one", "laptop edit").replace("line five", "phone edit"))
        assert not (vault / conflict_name("Note.md")).exists()
        assert model.prompts() == []
        assert "clean" in result.stdout
        assert conflict_name("Note.md") in result.stdout
        assert f"base {base[:7]}" in result.stdout

    @pytest.mark.parametrize("stale", ["conflict copy", "original"])
    def test_a_stale_copy_keeps_the_edits_already_committed(self, vault, env, model, stale):
        # The production bug. Agents edit the note on the VPS and vault-sync
        # commits each edit. The laptop's edit, made from the older version,
        # then arrives. HEAD already holds the VPS edits, so it is the wrong
        # base: against it git hands back the laptop copy and drops them.
        c0 = commit(vault, {"Note.md": BASE}, env)
        commit(vault, {"Note.md": BASE.replace("line one", "VPS edit one")}, env)
        vps = BASE.replace("line one", "VPS edit one").replace("line three", "VPS edit three")
        commit(vault, {"Note.md": vps}, env)
        laptop = BASE.replace("line five", "laptop edit")
        ours, theirs = (vps, laptop) if stale == "conflict copy" else (laptop, vps)
        write(vault, "Note.md", ours)
        write(vault, conflict_name("Note.md"), theirs)

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == vps.replace("line five", "laptop edit")
        assert not (vault / conflict_name("Note.md")).exists()
        assert model.prompts() == []
        assert f"base {c0[:7]}" in result.stdout

    def test_an_append_only_log_keeps_every_line_fast(self, vault, env, model):
        # Mirrors the 8,309-line state file the model once replaced with prose.
        entries = [f"seen 2026-10-14 message-{n:05d}\n" for n in range(8000)]
        commit(vault, {"state/seen.txt": "".join(entries[:7990])}, env)
        c0 = commit(vault, {"state/seen.txt": "".join(entries)}, env)
        vps_added = [f"seen by the VPS {n}\n" for n in range(5)]
        commit(vault, {"state/seen.txt": "".join(entries + vps_added)}, env)
        laptop_added = [f"seen by the laptop {n}\n" for n in range(3)]
        write(vault, conflict_name("state/seen.txt"), "".join(entries + laptop_added))

        started = time.monotonic()
        result = run(vault, env, model)
        elapsed = time.monotonic() - started

        assert (vault / "state/seen.txt").read_text() == "".join(
            entries + vps_added + laptop_added)
        assert not (vault / conflict_name("state/seen.txt")).exists()
        assert model.prompts() == []
        assert "clean" in result.stdout
        assert f"base {c0[:7]}" in result.stdout
        assert elapsed < 5

    def test_an_untracked_file_merges_on_the_lines_both_share(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, "New.md", "laptop top\na\nb\nc\nlaptop middle\nd\ne\n")
        write(vault, conflict_name("New.md"), "a\nb\nc\nphone middle\nd\ne\nphone bottom\n")

        result = run(vault, env, model)

        assert (vault / "New.md").read_text() == (
            "laptop top\na\nb\nc\nlaptop middle\nphone middle\nd\ne\nphone bottom\n")
        assert not (vault / conflict_name("New.md")).exists()
        assert model.prompts() == []
        assert "clean" in result.stdout
        assert "base common-lines" in result.stdout

    def test_a_half_typed_line_gives_way_to_the_fuller_one(self, vault, env, model):
        # 2026-10-16: Chris was mid-sentence on the laptop while an agent appended
        # to the same note on the VPS. Each side held a different snapshot of his
        # typing, and keeping both put the half-typed line in twice.
        commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md",
              BASE + "## 11:46\n\n- The pipeline is stalling, but it's happening\n\n")
        write(vault, conflict_name("Note.md"),
              BASE + "## 11:46\n\n- The pipeline is stalling - \n\n## 10:49 Agent\n\nbody\n")

        run(vault, env, model)

        assert (vault / "Note.md").read_text() == (
            BASE + "## 11:46\n\n- The pipeline is stalling, but it's happening\n\n"
            "## 10:49 Agent\n\nbody\n")
        assert model.prompts() == []

    def test_older_typing_snapshots_give_way_to_the_finished_lines(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        finished = ("- The pipeline is stalling, but it's happening and targets are up.\n"
                    "- I want passive income\n- \n")
        write(vault, "Note.md", BASE + finished)
        write(vault, conflict_name("Note.md"),
              BASE + "- The pipeline is stalling, but it's happening\n"
                     "- The pipeline is stalling - \n")

        run(vault, env, model)

        assert (vault / "Note.md").read_text() == BASE + finished
        assert model.prompts() == []

    def test_a_file_without_a_final_newline_keeps_it_that_way(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, "list.txt", "a\nb\nlaptop")
        write(vault, conflict_name("list.txt"), "a\nb\nphone")

        run(vault, env, model)

        assert (vault / "list.txt").read_text() == "a\nb\nlaptop\nphone"

    def test_an_identical_copy_is_just_removed(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, conflict_name("Note.md"), BASE)

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == BASE
        assert not (vault / conflict_name("Note.md")).exists()
        assert model.prompts() == []
        assert "clean" in result.stdout

    def test_both_inputs_are_saved_before_the_merge(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        ours = BASE.replace("line one", "ours")
        theirs = BASE.replace("line five", "theirs")
        write(vault, "Note.md", ours)
        write(vault, conflict_name("Note.md"), theirs)

        run(vault, env, model)

        assert saved(env) == {"Note.md": ours, conflict_name("Note.md"): theirs}

    def test_no_conflicts_means_no_output_and_no_state(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)

        result = run(vault, env, model)

        assert result.stdout == ""
        assert not Path(env["SYNC_CONFLICT_STATE_DIR"]).exists()


class TestModelResolvesConflicts:
    def test_only_the_conflict_and_its_context_go_to_the_model(self, vault, env, model):
        commit(vault, {"Note.md": NUMBERED}, env)
        write(vault, "Note.md", NUMBERED.replace("line 20", "laptop wording"))
        write(vault, conflict_name("Note.md"), NUMBERED.replace("line 20", "phone wording"))
        model.reply(resolutions("laptop wording\nphone wording\n"))

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == NUMBERED.replace(
            "line 20\n", "laptop wording\nphone wording\n")
        assert not (vault / conflict_name("Note.md")).exists()
        [prompt] = model.prompts()
        for wanted in ["Note.md", "line 17", "line 19", "line 20", "line 21", "line 23",
                       "laptop wording", "phone wording"]:
            assert wanted in prompt
        for unwanted in ["line 01", "line 16", "line 24", "line 40"]:
            assert unwanted not in prompt
        assert "llm" in result.stdout

    def test_every_conflict_goes_in_one_call(self, vault, env, model):
        commit(vault, {"Note.md": NUMBERED}, env)
        write(vault, "Note.md", NUMBERED.replace("line 10", "laptop ten")
              .replace("line 30", "laptop thirty"))
        write(vault, conflict_name("Note.md"), NUMBERED.replace("line 10", "phone ten")
              .replace("line 30", "phone thirty"))
        model.reply(resolutions("merged ten\n", "merged thirty\n"))

        run(vault, env, model)

        [prompt] = model.prompts()
        assert "laptop ten" in prompt and "phone thirty" in prompt
        assert (vault / "Note.md").read_text() == (
            NUMBERED.replace("line 10", "merged ten").replace("line 30", "merged thirty"))

    @pytest.mark.parametrize("reply, exit_code", [
        ("I won't reproduce that output. It is a state file of 8,309 lines.\n", 0),
        (resolutions("merged ten\n"), 0),
        (resolutions("merged ten\n", "merged thirty\n", "extra\n"), 0),
        ("<resolution 2>\nmerged thirty\n</resolution 2>\n"
         "<resolution 1>\nmerged ten\n</resolution 1>\n", 0),
        (resolutions("merged ten\n", "<<<<<<< ours\nlaptop thirty\n"), 0),
        (resolutions("laptop ten\n=======\nphone ten\n", "merged thirty\n"), 0),
        (resolutions("merged ten\n", "merged thirty\n") + "Hope that helps!\n", 0),
        (resolutions("merged ten\n", "merged thirty\n"), 1),
        ("", 0),
    ], ids=["prose", "too-few", "too-many", "out-of-order", "marker", "separator",
            "trailing-chat", "failed-exit", "empty"])
    def test_a_bad_reply_leaves_both_files_alone(self, vault, env, model, reply, exit_code):
        commit(vault, {"Note.md": NUMBERED}, env)
        ours = NUMBERED.replace("line 10", "laptop ten").replace("line 30", "laptop thirty")
        theirs = NUMBERED.replace("line 10", "phone ten").replace("line 30", "phone thirty")
        write(vault, "Note.md", ours)
        write(vault, conflict_name("Note.md"), theirs)
        model.reply(reply, exit_code=exit_code)

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == ours
        assert (vault / conflict_name("Note.md")).read_text() == theirs
        assert "skipped" in result.stdout

    def test_a_hung_model_is_abandoned_and_both_files_left_alone(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        ours = BASE.replace("line two", "laptop")
        write(vault, "Note.md", ours)
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "phone"))
        model.reply(resolutions("too late\n"), sleep=30)

        result = run(vault, env, model, SYNC_MERGE_TIMEOUT="1")

        assert (vault / "Note.md").read_text() == ours
        assert (vault / conflict_name("Note.md")).exists()
        assert "skipped" in result.stdout
        assert "timed out" in result.stdout

    def test_claude_is_found_in_local_bin_when_cron_path_lacks_it(self, vault, env, home):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md", BASE.replace("line two", "laptop"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "phone"))
        fake = FakeModel(home / "fake-claude")
        fake.reply(resolutions("merged by claude\n"))
        claude = home / ".local" / "bin" / "claude"
        claude.parent.mkdir(parents=True)
        claude.write_text(f"#!/bin/sh\nexec {fake.command} \"$@\"\n")
        claude.chmod(0o755)

        run(vault, env, PATH="/usr/bin:/bin")

        assert (vault / "Note.md").read_text() == BASE.replace("line two", "merged by claude")
        argv = (fake.calls / "0.argv").read_text().split("\0")
        assert "-p" in argv
        assert argv[argv.index("--model") + 1] == "sonnet"
        assert argv[argv.index("--tools") + 1] == ""
        for flag in ["--strict-mcp-config", "--safe-mode", "--no-session-persistence"]:
            assert flag in argv


class TestLeftAlone:
    def test_conflict_whose_original_is_gone_is_skipped(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, conflict_name("Gone.md"), "orphan\n")

        result = run(vault, env, model)

        assert (vault / conflict_name("Gone.md")).read_text() == "orphan\n"
        assert not (vault / "Gone.md").exists()
        assert model.prompts() == []
        assert "skipped" in result.stdout

    def test_binary_files_are_skipped(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, "image.png", b"\x89PNG\xff\xfe laptop")
        write(vault, conflict_name("image.png"), b"\x89PNG\xff\xfe phone")

        result = run(vault, env, model)

        assert (vault / "image.png").read_bytes() == b"\x89PNG\xff\xfe laptop"
        assert (vault / conflict_name("image.png")).read_bytes() == b"\x89PNG\xff\xfe phone"
        assert model.prompts() == []
        assert "skipped" in result.stdout

    def test_git_internals_are_never_touched(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, ".git/notes.txt", "a\n")
        write(vault, ".git/" + conflict_name("notes.txt"), "b\n")

        result = run(vault, env, model)

        assert (vault / ".git" / conflict_name("notes.txt")).read_text() == "b\n"
        assert result.stdout == ""

    def test_one_bad_conflict_does_not_stop_the_others(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, conflict_name("Gone.md"), "orphan\n")
        write(vault, "Note.md", BASE.replace("line one", "laptop"))
        write(vault, conflict_name("Note.md"), BASE.replace("line five", "phone"))

        result = run(vault, env, model)

        assert not (vault / conflict_name("Note.md")).exists()
        assert "skipped" in result.stdout
        assert "clean" in result.stdout


@pytest.mark.parametrize("name", [
    "Daily Note.md",
    "Projects/Big Ideas/Plan for Q4.md",
    "notes/README",
    ".gitignore",
    "archive.tar.gz",
    "[2026] Plan*.md",
])
def test_conflict_names_are_mapped_back_to_their_original(vault, env, model, name):
    commit(vault, {name: BASE}, env)
    write(vault, name, BASE.replace("line one", "laptop"))
    write(vault, conflict_name(name), BASE.replace("line five", "phone"))

    run(vault, env, model)

    assert (vault / name).read_text() == (
        BASE.replace("line one", "laptop").replace("line five", "phone"))
    assert not (vault / conflict_name(name)).exists()
    assert conflict_name(name) in saved(env)


class TestVaultBackup:
    """vault-sync.sh runs the resolver before staging anything."""

    @pytest.fixture
    def origin(self, tmp_path, vault, env):
        bare = tmp_path / "origin.git"
        subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(bare)],
                       env=env, check=True)
        commit(vault, {"Note.md": BASE}, env)
        git(vault, "remote", "add", "origin", str(bare), env=env)
        git(vault, "push", "-q", "-u", "origin", "main", env=env)
        (vault.parent / "bin").mkdir()
        return bare

    def backup(self, env, **extra):
        return subprocess.run(["bash", str(VAULT_SYNC)], env={**env, **extra},
                              capture_output=True, text=True, timeout=120)

    def test_merged_note_is_committed_and_conflict_copy_never_is(
            self, vault, env, model, origin, home):
        write(vault, "Note.md", BASE.replace("line one", "laptop"))
        write(vault, conflict_name("Note.md"), BASE.replace("line five", "phone"))

        assert self.backup(env, SYNC_MERGE_CMD=model.command).returncode == 0

        files = git(origin, "ls-tree", "-r", "--name-only", "main", env=env).split("\n")
        assert conflict_name("Note.md") not in files
        assert git(origin, "show", "main:Note.md", env=env) == (
            BASE.replace("line one", "laptop").replace("line five", "phone"))
        assert "clean" in (home / "bin" / "sync-conflict-merge.log").read_text()

    def test_backup_still_happens_when_the_resolver_fails(
            self, vault, env, model, origin):
        write(vault, "Note.md", BASE.replace("line two", "laptop"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "phone"))
        model.reply("", exit_code=1)

        assert self.backup(env, SYNC_MERGE_CMD=model.command).returncode == 0

        files = git(origin, "ls-tree", "-r", "--name-only", "main", env=env).split("\n")
        assert conflict_name("Note.md") in files
        assert "laptop" in git(origin, "show", "main:Note.md", env=env)
