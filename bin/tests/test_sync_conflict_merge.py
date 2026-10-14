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
from pathlib import Path

import pytest

BIN = Path(__file__).resolve().parents[1]
SCRIPT = BIN / "sync-conflict-merge"
VAULT_SYNC = BIN / "vault-sync.sh"

STAMP = "20261014-153012-ABCDEF7"

BASE = "# Note\n\nline one\nline two\nline three\nline four\nline five\n"


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
    for name, content in files.items():
        target = vault / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content)
    git(vault, "add", "-A", env=env)
    git(vault, "commit", "-q", "-m", "base", env=env)


def write(vault, name, content):
    target = vault / name
    target.parent.mkdir(parents=True, exist_ok=True)
    if isinstance(content, bytes):
        target.write_bytes(content)
    else:
        target.write_text(content)
    return target


class FakeModel:
    """Stands in for `claude -p`: records what it was sent, replies on cue."""

    def __init__(self, root):
        self.root = root
        self.calls = root / "calls"
        self.calls.mkdir(parents=True)
        self.script = root / "fake-merge.py"
        self.reply("merged by fake\n")

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


class TestEveryConflict:
    def test_edits_to_different_lines_also_go_to_the_model(self, vault, env, model):
        # No deterministic merge: git has no trustworthy base to merge against.
        commit(vault, {"Note.md": BASE}, env)
        ours = BASE.replace("line one", "line one, edited on the laptop")
        theirs = BASE.replace("line five", "line five, edited on the phone")
        write(vault, "Note.md", ours)
        write(vault, conflict_name("Note.md"), theirs)

        result = run(vault, env, model)

        [prompt] = model.prompts()
        assert ours in prompt
        assert theirs in prompt
        assert (vault / "Note.md").read_text() == "merged by fake\n"
        assert not (vault / conflict_name("Note.md")).exists()
        assert "llm" in result.stdout
        assert conflict_name("Note.md") in result.stdout

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


class TestModelMerge:
    def test_an_edit_already_committed_survives_a_stale_copy(self, vault, env, model):
        # An agent edits the note on the VPS and vault-sync commits it. The
        # laptop's edit, made from the older version, then arrives as the
        # conflict copy. Against HEAD as base, git would hand back the laptop's
        # copy as a clean merge and silently drop the committed edit.
        commit(vault, {"Note.md": BASE}, env)
        vps = BASE.replace("line one", "agent edit on the VPS")
        commit(vault, {"Note.md": vps}, env)
        write(vault, conflict_name("Note.md"), BASE.replace("line five", "laptop edit"))
        model.reply("merged by fake\n")

        run(vault, env, model)

        [prompt] = model.prompts()
        assert "agent edit on the VPS" in prompt
        assert "laptop edit" in prompt
        assert (vault / "Note.md").read_text() == "merged by fake\n"
        assert not (vault / conflict_name("Note.md")).exists()

    def test_edits_to_the_same_line_go_to_the_model(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md", BASE.replace("line two", "laptop wording"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "phone wording"))
        model.reply("the merged note\n")

        result = run(vault, env, model)

        assert (vault / "Note.md").read_text() == "the merged note\n"
        assert not (vault / conflict_name("Note.md")).exists()
        [prompt] = model.prompts()
        assert "Note.md" in prompt
        assert "laptop wording" in prompt
        assert "phone wording" in prompt
        assert "llm" in result.stdout

    def test_untracked_file_goes_to_the_model(self, vault, env, model):
        commit(vault, {"Other.md": "x\n"}, env)
        write(vault, "New.md", "written on the laptop\n")
        write(vault, conflict_name("New.md"), "written on the phone\n")
        model.reply("both\n")

        run(vault, env, model)

        assert (vault / "New.md").read_text() == "both\n"
        assert not (vault / conflict_name("New.md")).exists()
        [prompt] = model.prompts()
        assert "written on the laptop" in prompt
        assert "written on the phone" in prompt

    def test_a_wrapping_code_fence_from_the_model_is_removed(self, vault, env, model):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md", BASE.replace("line two", "a"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "b"))
        model.reply("```markdown\n# Merged\n\nbody\n```\n")

        run(vault, env, model)

        assert (vault / "Note.md").read_text() == "# Merged\n\nbody\n"

    @pytest.mark.parametrize("reply", ["merged", "merged\n\n\n"])
    def test_the_reply_ends_the_way_the_note_did(self, vault, env, model, reply):
        commit(vault, {"Note.md": BASE}, env)
        write(vault, "Note.md", BASE.replace("line two", "a"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "b"))
        model.reply(reply)

        run(vault, env, model)

        assert (vault / "Note.md").read_text() == "merged\n"

    def test_a_fence_that_belongs_to_the_note_is_kept(self, vault, env, model):
        fenced = "```\ncode\n```\n"
        commit(vault, {"snippet.md": fenced}, env)
        write(vault, "snippet.md", "```\nlaptop\n```\n")
        write(vault, conflict_name("snippet.md"), "```\nphone\n```\n")
        model.reply("```\nlaptop\nphone\n```\n")

        run(vault, env, model)

        assert (vault / "snippet.md").read_text() == "```\nlaptop\nphone\n```\n"

    @pytest.mark.parametrize("reply, exit_code", [("half a merge\n", 1), ("", 0), ("  \n", 0)])
    def test_a_failed_or_empty_reply_leaves_both_files_alone(self, vault, env, model,
                                                            reply, exit_code):
        commit(vault, {"Note.md": BASE}, env)
        ours = BASE.replace("line two", "laptop")
        theirs = BASE.replace("line two", "phone")
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
        model.reply("too late\n", sleep=30)

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
        fake.reply("merged by claude\n")
        claude = home / ".local" / "bin" / "claude"
        claude.parent.mkdir(parents=True)
        claude.write_text(f"#!/bin/sh\nexec {fake.command} \"$@\"\n")
        claude.chmod(0o755)

        run(vault, env, PATH="/usr/bin:/bin")

        assert (vault / "Note.md").read_text() == "merged by claude\n"
        argv = (fake.calls / "0.argv").read_text().split("\0")
        assert "-p" in argv
        assert argv[argv.index("--model") + 1] == "sonnet"
        assert argv[argv.index("--tools") + 1] == ""


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
        assert "llm" in result.stdout


@pytest.mark.parametrize("name", [
    "Daily Note.md",
    "Projects/Big Ideas/Plan for Q4.md",
    "notes/README",
    ".gitignore",
    "archive.tar.gz",
])
def test_conflict_names_are_mapped_back_to_their_original(vault, env, model, name):
    commit(vault, {name: BASE}, env)
    write(vault, name, BASE.replace("line one", "laptop"))
    write(vault, conflict_name(name), BASE.replace("line five", "phone"))

    run(vault, env, model)

    assert (vault / name).read_text() == "merged by fake\n"
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
        assert git(origin, "show", "main:Note.md", env=env) == "merged by fake\n"
        assert "llm" in (home / "bin" / "sync-conflict-merge.log").read_text()

    def test_backup_still_happens_when_the_resolver_fails(
            self, vault, env, model, origin):
        write(vault, "Note.md", BASE.replace("line two", "laptop"))
        write(vault, conflict_name("Note.md"), BASE.replace("line two", "phone"))
        model.reply("", exit_code=1)

        assert self.backup(env, SYNC_MERGE_CMD=model.command).returncode == 0

        files = git(origin, "ls-tree", "-r", "--name-only", "main", env=env).split("\n")
        assert conflict_name("Note.md") in files
        assert "laptop" in git(origin, "show", "main:Note.md", env=env)
