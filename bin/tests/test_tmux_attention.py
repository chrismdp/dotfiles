import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().parents[1] / "tmux-attention"


@unittest.skipUnless(shutil.which("tmux"), "tmux is required")
class TmuxAttentionTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.socket = str(self.root / "tmux.sock")
        self.tmux = shutil.which("tmux")
        self.env = {k: v for k, v in os.environ.items()
                    if k not in ("TMUX", "TMUX_PANE")}
        wrapper = self.root / "tmux"
        wrapper.write_text('#!/bin/sh\nexec "$ATTENTION_TEST_TMUX" -S "$ATTENTION_TEST_SOCKET" "$@"\n')
        wrapper.chmod(0o755)
        self.env.update(PATH=f"{self.root}:{self.env['PATH']}",
                        ATTENTION_TEST_TMUX=self.tmux,
                        ATTENTION_TEST_SOCKET=self.socket)
        self.call("-f", "/dev/null", "new-session", "-d", "-s", "test",
                  "-n", "example", "-c", str(self.root), "sleep 300")
        self.addCleanup(lambda: self.call("kill-server"))
        self.pane = self.call("display-message", "-p", "#{pane_id}").strip()

    def call(self, *args):
        return subprocess.check_output([self.tmux, "-S", self.socket, *args],
                                       text=True, env=self.env)

    def run_hook(self, state, payload=None, **extra_env):
        return subprocess.run(["bash", str(SCRIPT), state],
                              input=json.dumps(payload or {"cwd": str(self.root)}),
                              text=True, capture_output=True, check=True,
                              env={**self.env, **extra_env})

    def name(self):
        return self.call("display-message", "-p", "-t", self.pane, "#W").strip()

    def test_server_without_tmux_environment_sets_and_clears_suffix(self):
        self.run_hook("waiting")
        self.assertEqual(self.name(), "example ❖")
        self.run_hook("waiting")
        self.assertEqual(self.name(), "example ❖")
        self.run_hook("clear")
        self.assertEqual(self.name(), "example")

    def test_question_and_work_use_the_same_hook_payload(self):
        self.run_hook("pre-tool", {"cwd": str(self.root),
                                    "tool_name": "functions.request_user_input"})
        self.assertEqual(self.name(), "example ❖")
        self.run_hook("pre-tool", {"cwd": str(self.root), "tool_name": "Bash"})
        self.assertEqual(self.name(), "example")

    def test_ambiguous_directory_does_not_rename_a_window(self):
        self.call("new-window", "-d", "-n", "other", "-c", str(self.root), "sleep 300")
        self.run_hook("waiting")
        self.assertEqual(self.name(), "example")
        self.assertEqual(self.call("list-windows", "-F", "#W").splitlines(),
                         ["example", "other"])

    def test_explicit_pane_still_works_with_no_input(self):
        result = subprocess.run(["bash", str(SCRIPT), "waiting"], input="",
                                text=True, capture_output=True, check=True,
                                env={**self.env, "TMUX": self.socket,
                                     "TMUX_PANE": self.pane})
        self.assertEqual(result.stdout, "")
        self.assertEqual(self.name(), "example ❖")


if __name__ == "__main__":
    unittest.main()
