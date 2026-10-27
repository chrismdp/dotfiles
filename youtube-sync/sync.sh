#!/bin/bash
set -eu
umask 077
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
export LANG=en_GB.UTF-8 LC_ALL=en_GB.UTF-8
BASE="$HOME/youtube-sync"
mkdir -p "$BASE/out"
if [ "${1:-}" != "--self-test" ]; then
  exec >> "$BASE/sync.log" 2>&1
fi
exec /usr/bin/ruby - "$@" <<'RUBY'
require 'json'
require 'yaml'
require 'time'
require 'set'
require 'open3'
require 'timeout'
require 'tmpdir'
require 'cgi'

BASE = File.expand_path('~/youtube-sync')
BROWSERS = ['chrome:Profile 2', 'chrome:Profile 5'] # Personal and chrismdp.
# Useful short videos can be explicitly retained despite the duration filter.
SHORT_EXCEPTIONS = Set.new(['en0GuyhieQk']) # Claude Dashboards and Claude Motion.
REMOTE = 'vps:vault/youtube-transcripts/'
YTDLP = ['/opt/homebrew/bin/yt-dlp', '--ignore-config', '--no-progress',
         '--sleep-requests', '2',
         '--socket-timeout', '30', '--retries', '2']

def log(message)
  puts "#{Time.now.iso8601} #{message}"
  STDOUT.flush
end

def gameplay?(title)
  # Keep reviews and design discussions, including videos in Gaming.
  return false if title.match?(/\b(design|review|analysis|critique)\b/i)
  title.match?(/\b(play[ -]?through|let['’]?s play|gameplay|tutorial missions)\b/i) ||
    title.match?(/\bTerra Invicta\b.*\bE\d+\b/i)
end

def run(*args, limit: 300)
  output = error = nil
  status = nil
  Open3.popen3(*args, pgroup: true) do |stdin, stdout, stderr, wait|
    stdin.close
    out_reader = Thread.new { stdout.read }
    err_reader = Thread.new { stderr.read }
    begin
      Timeout.timeout(limit) { status = wait.value }
    rescue Timeout::Error
      Process.kill('TERM', -wait.pid) rescue nil
      sleep 1
      Process.kill('KILL', -wait.pid) rescue nil
      raise "Command timed out: #{args.first}"
    ensure
      output = out_reader.value
      error = err_reader.value
    end
  end
  log(error.strip) unless error.strip.empty?
  raise "Command failed (#{status.exitstatus}): #{args.first}" unless status.success?
  output
end

def transcript(vtt)
  previous = []
  chunks = []
  vtt.gsub("\r", '').split(/\n\s*\n/).each do |block|
    lines = block.lines.map(&:strip)
    i = lines.index { |line| line.match?(/\A(?:\d+:)?\d{2}:\d{2}\.\d+\s+-->/) }
    next unless i
    stamp = lines[i].split.first.split(':').map(&:to_f)
    seconds = stamp.reverse.each_with_index.sum { |n, power| n * (60 ** power) }
    clean = CGI.unescapeHTML(lines[(i + 1)..-1].join(' ').gsub(/<[^>]*>/, '')).gsub(/\s+/, ' ').strip
    next if clean.empty?
    words = clean.split
    overlap = [previous.length, words.length].min
    overlap -= 1 while overlap > 0 && previous.last(overlap) != words.first(overlap)
    fresh = words.drop(overlap)
    previous = words
    chunks << [seconds, fresh.join(' ')] unless fresh.empty?
  end
  result = []
  marker = nil
  chunks.each do |seconds, text|
    if marker.nil? || seconds - marker >= 60
      marker = seconds
      result << "\n[%02d:%02d]" % [seconds.to_i / 60, seconds.to_i % 60]
    end
    result << text
  end
  result.join(' ').strip.gsub(/ *\n */, "\n\n") + "\n"
end

if ARGV.include?('--self-test')
  vtt = "WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello <c>world</c>\n\n00:00:02.000 --> 00:00:03.000\nHello world\nagain &amp; again\n\n00:01:04.000 --> 00:01:06.000\nagain &amp; again\nNext minute\n"
  result = transcript(vtt)
  raise result unless result == "[00:01] Hello world again & again\n\n[01:04] Next minute\n"
  raise 'Gameplay filter' unless gameplay?('Atlantic Chase - Tutorial Missions #7') && gameplay?('A 4p Play-through')
  raise 'Design/review filter' if gameplay?('Board Game Design Analysis') || gameplay?('World Order | Board Game Review')
  puts 'PASS: VTT tags, entities, rolling overlap and minute markers'
  exit
end

lock = File.open(File.join(BASE, 'sync.sh'), 'r')
unless lock.flock(File::LOCK_EX | File::LOCK_NB)
  log('Another sync is running; exiting')
  exit
end
begin
  log("START browsers=#{BROWSERS.join(', ')}")
  seen_path = File.join(BASE, 'seen.txt')
  seen = Set.new(File.exist?(seen_path) ? File.readlines(seen_path, chomp: true) : [])
  staged = Set.new
  failures = 0
  rows = BROWSERS.flat_map do |browser|
    history = run(*YTDLP, '--cookies-from-browser', browser, '--flat-playlist', '--playlist-end', '50', '--print',
                  "%(id)s\t%(title)s\t%(channel)s", ':ythistory')
    log("HISTORY #{browser}: #{history.lines.length} entries")
    history.lines.map { |line| line.chomp.split("\t", 3) + [browser] }
  end.uniq { |row| row.first }
  log("FOUND #{rows.length} unique videos across both profiles")
  rows.each do |id, title, _channel, browser|
    ytdlp = YTDLP + ['--cookies-from-browser', browser]
    raise "Unexpected history id: #{id.inspect}" unless id && id.match?(/\A[A-Za-z0-9_-]{11}\z/)
    log("FOUND #{id} #{title}")
    output_path = File.join(BASE, 'out', "#{id}.md")
    if seen.include?(id) && !(SHORT_EXCEPTIONS.include?(id) && !File.exist?(output_path))
      log("SKIP #{id}: already seen")
      next
    end
    if gameplay?(title.to_s)
      log("SKIP #{id} #{title}: gameplay / playthrough")
      # Remove only this job's unshipped output if preferences changed mid-run.
      File.delete(output_path) if File.exist?(output_path)
      staged.add(id)
      next
    end
    if File.exist?(output_path)
      staged.add(id)
      log("READY #{id}: retrying delivery of existing transcript")
      next
    end
    begin
      url = "https://www.youtube.com/watch?v=#{id}"
      metadata = JSON.parse(run(*ytdlp, '--no-playlist', '--skip-download', '--dump-single-json', url))
      reason = if Array(metadata['categories']).include?('Music')
                 'Music category'
               elsif metadata['duration'] && metadata['duration'] < 240 && !SHORT_EXCEPTIONS.include?(id)
                 "Short / under 4 minutes (#{metadata['duration']} seconds)"
               elsif metadata['webpage_url'].to_s.include?('/shorts/')
                 'YouTube Short'
               end
      if reason
        log("SKIP #{id} #{title}: #{reason}")
        staged.add(id)
        next
      end
      raise 'Duration unavailable; retry later' unless metadata['duration']
      raise 'Live video is not complete; retry later' if %w[is_live is_upcoming post_live].include?(metadata['live_status'])
      captions = metadata.fetch('automatic_captions', {}).keys.grep(/\Aen(?:\z|[-_])/)
      body = nil
      unless captions.empty?
        Dir.mktmpdir('youtube-sync-') do |work|
          info = File.join(work, 'info.json')
          File.write(info, JSON.generate(metadata))
          # --write-subs also includes human subtitles. Disable those explicitly
          # because this job is for auto-captions only. Prefer original English.
          lang = captions.include?('en-orig') ? 'en-orig' : (captions.include?('en') ? 'en' : captions.sort.first)
          run(*ytdlp, '--load-info-json', info, '--skip-download', '--write-auto-subs',
              '--no-write-subs', '--sub-langs', lang, '--sub-format', 'vtt',
              '--sleep-subtitles', '2', '-o', File.join(work, '%(id)s.%(ext)s'))
          files = Dir.glob(File.join(work, '*.vtt'))
          raise 'Caption download produced no VTT; retry later' if files.empty?
          body = transcript(File.read(files.first))
          raise 'Caption conversion produced no text; retry later' if body.strip.empty?
        end
      end
      front = {
        'title' => metadata['title'], 'url' => url, 'channel' => metadata['channel'],
        'upload_date' => metadata['upload_date'], 'duration' => metadata['duration'],
        'watched_detected_at' => Time.now.iso8601
      }
      front['transcript'] = 'none' unless body
      temp = output_path + '.part'
      File.write(temp, front.to_yaml + "---\n\n" + (body || "transcript: none\n"))
      File.rename(temp, output_path)
      staged.add(id)
      log("WRITE #{id} #{title}: #{body ? 'transcript saved' : 'no English auto-captions'}")
    rescue => e
      failures += 1
      log("ERROR #{id} #{title}: #{e.message}; remains unseen for retry")
    end
  end
  # Transfer completes before committing ANY new seen IDs. No remote commands
  # other than the rsync receiver; no --delete and no SSH configuration changes.
  # umask 077 makes the staged files 0600 and rsync keeps that mode on new remote files,
  # which locks the workflow user out of the vault copies.
  Dir.glob(File.join(BASE, 'out', '*.md')).each { |f| File.chmod(0o664, f) }
  run('/usr/bin/rsync', '-rt', '--include=*.md', '--exclude=*',
      '-e', '/usr/bin/env -u LC_ALL -u LANG /usr/bin/ssh -o BatchMode=yes -o ConnectTimeout=15 -o StrictHostKeyChecking=yes',
      File.join(BASE, 'out') + '/', REMOTE)
  temp_seen = seen_path + '.part'
  File.write(temp_seen, (seen | staged).to_a.sort.join("\n") + ((seen | staged).empty? ? '' : "\n"))
  File.rename(temp_seen, seen_path)
  log("DONE delivered; committed #{staged.length} IDs; #{failures} failures to retry")
  exit(failures.zero? ? 0 : 1)
rescue => e
  log("FAILED #{e.message}; uncommitted IDs remain unseen")
  exit 1
end
RUBY
