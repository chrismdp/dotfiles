# YouTube transcript sync (macOS)

Pulls the latest 50 YouTube history entries from each of Chrome's Personal
(`Profile 2`) and chrismdp (`Profile 5`) profiles. Saves English auto-caption
transcripts with source metadata and minute markers in
`~/vault/youtube-transcripts/`, then copies them over SSH to
`vps:~/vault/youtube-transcripts/`.

Music, videos under four minutes and obvious gameplay/playthrough titles are
skipped. Reviews and design discussions are retained. `SHORT_EXCEPTIONS` in
`sync.sh` includes the 82-second Claude Dashboards and Claude Motion announcement.
The gameplay filter uses titles, so ambiguous gameplay may remain.

## Install on this Mac

Requires Homebrew's `yt-dlp`, the signed-in Chrome profiles, macOS Ruby, and
passwordless SSH to the server. Browser cookies stay on the Mac. Approve any
Keychain request yourself; never put a password or exported cookies in this repo.

From this repository's root (`~/code/config_files` on this Mac):

```sh
brew install yt-dlp
mkdir -p ~/youtube-sync ~/vault/youtube-transcripts ~/Library/LaunchAgents
ln -sfn "$PWD/youtube-sync/sync.sh" ~/youtube-sync/sync.sh
ln -sfn "$PWD/youtube-sync/com.cp.youtube-sync.plist" ~/youtube-sync/com.cp.youtube-sync.plist
```

For a fresh installation, create the output link:

```sh
ln -s ~/vault/youtube-transcripts ~/youtube-sync/out
```

If `out` already exists, retain it if it points to the vault; otherwise move its
files into the vault before replacing it with that symlink.

Test before loading the agent:

```sh
~/youtube-sync/sync.sh --self-test
ssh -o BatchMode=yes vps true
~/youtube-sync/sync.sh
ln -sfn "$PWD/youtube-sync/com.cp.youtube-sync.plist" ~/Library/LaunchAgents/com.cp.youtube-sync.plist
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.cp.youtube-sync.plist
```

If the agent is already loaded, unload it with the command below before
bootstrapping it again. The plist uses `/Users/cp` paths; edit those and check
Chrome profile names before installing on another account or Mac.

## Run and inspect

```sh
launchctl kickstart gui/$(id -u)/com.cp.youtube-sync
launchctl print gui/$(id -u)/com.cp.youtube-sync
tail -50 ~/youtube-sync/sync.log
```

The agent runs every 3,600 seconds while awake and logged in; it does not wake the
Mac. Concurrent runs exit without doing work. New IDs are committed to
`~/youtube-sync/seen.txt` only after rsync succeeds. Download failures remain
unseen for retry. `watched_detected_at` records detection time, not the original
watch time. Videos with no English auto-captions get `transcript: none`.

Only the script and plist are configuration. Logs, seen IDs and transcripts stay
outside this repository. The transcript archive belongs to the vault.

## Turn off

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.cp.youtube-sync.plist
rm ~/Library/LaunchAgents/com.cp.youtube-sync.plist
```

This preserves the script, local state and transcript archive.
