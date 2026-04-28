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
  ln -sf ~/code/dotfiles/claude/hooks ~/.claude/hooks
</pre>

Machine-specific overrides (extra permissions, local tools) go in
`~/.claude/settings.local.json` which is not tracked in this repo.

SYSTEMD USER SERVICES
---------------------

<pre>
  mkdir -p ~/.config/systemd/user
  for svc in claude-worker@.service voice-inbox.service; do
    ln -sf ~/code/dotfiles/systemd/user/$svc ~/.config/systemd/user/$svc
  done
  systemctl --user daemon-reload
  systemctl --user enable --now claude-worker@1
  systemctl --user enable --now voice-inbox
</pre>

`voice-inbox.service` reads its config from `~/code/voice-inbox/.env` (not tracked).

SYSTEMD SYSTEM SERVICES
-----------------------

<pre>
  for svc in claude-inbox-watcher.service telegram-webhook.service; do
    sudo ln -sf ~/code/dotfiles/systemd/system/$svc /etc/systemd/system/$svc
  done
  sudo systemctl daemon-reload
  sudo systemctl enable --now claude-inbox-watcher telegram-webhook
</pre>

`telegram-webhook.service` sources `~/.secret_env` for `TELEGRAM_BOT_TOKEN` etc.

NGINX SITES
-----------

<pre>
  sudo ln -sf ~/code/dotfiles/nginx/sites-available/telegram-webhook /etc/nginx/sites-available/telegram-webhook
  sudo ln -sf /etc/nginx/sites-available/telegram-webhook /etc/nginx/sites-enabled/telegram-webhook
  sudo nginx -t && sudo systemctl reload nginx
</pre>

Site depends on a Let's Encrypt cert at `/etc/letsencrypt/live/vps.chrismdp.com/`
— provision separately with `certbot --nginx`.

What's in each file:

- **CLAUDE.md** - Global instructions, communication style, tool usage rules
- **skills/** - Skill definitions (submodule) for slash commands
- **settings.json** - Permissions, model preference, hooks, statusline config.
  All paths use `~` so they're portable across machines.
- **statusline.sh** - Custom status bar with context window, API usage bars,
  vault sync status (✓↑ = committed/synced, ♡ = heartbeat), and rate limit info.
  Reads runtime credentials from `~/.claude/.credentials.json` (not tracked).
- **systemd/user/** - User systemd unit files (claude-worker template, voice-inbox).
- **systemd/system/** - System-level systemd unit files (claude-inbox-watcher, telegram-webhook).
- **nginx/sites-available/** - Nginx vhost config for `vps.chrismdp.com` (telegram-webhook + review board + voice inbox).
- **crontab.vps** - VPS crontab. Install with `crontab ~/code/dotfiles/crontab.vps`.
