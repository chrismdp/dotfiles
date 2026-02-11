INSTALLATION
------------

Don't forget to install all the vim bundle submodules:

<pre>
  git submodule update --init
</pre>

Then link up as many files as you want to use...
<pre>
  cd ~
  ln -sf config_files/vimrc ~/.vimrc
  ln -sf config_files/vim ~/.vim
  ln -sf config_files/irssi ~/.irssi
  ln -sf config_files/gvimrc ~/.gvimrc
  ln -sf config_files/ackrc ~/.ackrc
</pre>

CLAUDE CODE
-----------

Symlink the shared Claude Code config into `~/.claude/`:

<pre>
  mkdir -p ~/.claude
  ln -sf ~/code/dotfiles/claude/CLAUDE.md ~/.claude/CLAUDE.md
  ln -sf ~/code/dotfiles/claude/skills ~/.claude/skills
  ln -sf ~/code/dotfiles/claude/settings.json ~/.claude/settings.json
  ln -sf ~/code/dotfiles/claude/statusline.sh ~/.claude/statusline.sh
</pre>

Machine-specific overrides (extra permissions, local tools) go in
`~/.claude/settings.local.json` which is not tracked in this repo.

What's in each file:

- **CLAUDE.md** - Global instructions, communication style, tool usage rules
- **skills/** - Skill definitions (submodule) for slash commands
- **settings.json** - Permissions, model preference, hooks, statusline config.
  All paths use `~` so they're portable across machines.
- **statusline.sh** - Custom status bar with context window, API usage bars,
  vault sync status (✓↑ = committed/synced, ♡ = heartbeat), and rate limit info.
  Reads runtime credentials from `~/.claude/.credentials.json` (not tracked).
