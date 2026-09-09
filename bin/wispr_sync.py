#!/usr/bin/env python3
"""Pull finalised Wispr Flow meeting transcripts into the vault.

Sibling of sync-drive-transcripts.sh: download only. Once a file lands in
vault/transcripts/, vault-sync.sh commits it and process-new-transcripts.sh
fires Em's routing reflex, which fans it out to the agents.

Wispr has no REST endpoint for recorded meetings — the retrieval surface is
its MCP server. This talks to it directly over streamable HTTP with its own
OAuth token, so cron needs no model call and no Claude session.

    wispr_sync.py auth     one-time; prints a code for Chris to enter
    wispr_sync.py sync     what cron runs
    wispr_sync.py status   token state and last sync
"""

import base64
import hashlib
import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

MCP_URL = "https://api.wisprflow.ai/connect/mcp"
AUTH_BASE = "https://mcp-auth.wisprflow.com"
SCOPE = "openid offline_access"
REDIRECT_URI = "http://localhost:7391/callback"

VAULT = Path.home() / "vault"
TRANSCRIPTS = VAULT / "transcripts"
CONFIG_DIR = Path.home() / ".config" / "wispr-sync"
TOKEN_FILE = CONFIG_DIR / "token.json"
STATE_FILE = CONFIG_DIR / "synced-meetings.txt"
ALERT_FILE = CONFIG_DIR / "alert-state.json"
SEND_SH = Path.home() / ".claude" / "skills" / "telegram" / "scripts" / "send.sh"
ALERT_COOLDOWN = 6 * 3600
LOG_FILE = Path.home() / "bin" / "sync-wispr-transcripts.log"

LOCAL_TZ = ZoneInfo("Europe/London")
LOOKBACK_DAYS = 7  # state file makes re-scanning free; a short window silently drops late arrivals
SETTLE_MINUTES = 5  # Wispr keeps writing for a moment after the call drops
TRANSCRIPT_PAGE = 40000
REFRESH_MARGIN = 300  # refresh early — a sync run can take a couple of minutes

# Titles share these; they carry no signal about which meeting it was.
STOPWORDS = {
    "a", "and", "call", "catch", "chat", "chris", "meeting", "notes", "quick",
    "sync", "the", "up", "with", "by", "gemini", "bst", "gmt", "weekly", "1", "2",
}


# --- pure helpers (tested) ---------------------------------------------------

def _parse_iso(value):
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def is_ready(meeting, now):
    """Only sync a meeting that has stopped moving.

    A live meeting's transcript is partial — fanning that out to the agents
    would brief them on half a conversation.
    """
    if not meeting.get("finalized") or not meeting.get("has_transcript"):
        return False
    end = _parse_iso(meeting.get("end"))
    if end is None:
        return False
    return end <= _parse_iso(now) - timedelta(minutes=SETTLE_MINUTES)


def _slug(text):
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    text = re.sub(r"[^a-z0-9]+", "-", text)
    return text.strip("-")


def filename_for(meeting):
    date = _parse_iso(meeting["start"]).astimezone(LOCAL_TZ).strftime("%Y-%m-%d")
    slug = _slug(meeting.get("title") or "") or "untitled-meeting"
    slug = slug[:66].rstrip("-")
    return f"{date}-{slug}.md"


def _signature(text):
    return {w for w in re.split(r"[^a-z0-9]+", _slug(text).replace("-", " ")) if w and w not in STOPWORDS}


def existing_match(meeting, existing_names):
    """Find a transcript the vault already holds for this meeting.

    Google Meet calls arrive twice — once as a Gemini note via Drive, once
    from Wispr — and a second copy double-fires the agent fan-out.
    """
    target = filename_for(meeting)
    if target in existing_names:
        return target

    date = _parse_iso(meeting["start"]).astimezone(LOCAL_TZ)
    same_day = (date.strftime("%Y-%m-%d"), date.strftime("%Y %m %d"), date.strftime("%Y%m%d"))
    words = _signature(meeting.get("title") or "")
    if not words:
        return None

    scored = []
    for name in existing_names:
        if not any(d in name for d in same_day):
            continue
        overlap = len(words & _signature(Path(name).stem))
        if overlap:
            scored.append((overlap, name))
    if not scored:
        return None

    best = max(score for score, _ in scored)
    winners = [name for score, name in scored if score == best]
    if len(winners) > 1:
        # Two same-day files match equally well — most likely neither is this
        # meeting. Download it: a duplicate is noisy but visible, a silently
        # dropped transcript is not.
        return None
    return winners[0]


def render(detail):
    title = detail.get("title") or "Untitled meeting"
    start = _parse_iso(detail["start"]).astimezone(LOCAL_TZ)
    end = _parse_iso(detail.get("end"))
    when = start.strftime("%Y-%m-%d %H:%M")
    if end:
        when += end.astimezone(LOCAL_TZ).strftime("–%H:%M")
    when += start.strftime(" %Z")

    names = [a.get("name") for a in detail.get("attendees") or [] if a.get("name")]

    out = [f"# {title}", "", "## Meeting Info", f"- Date: {when}",
           f"- Source: Wispr Flow (meeting id `{detail['id']}`)"]
    if names:
        out.append(f"- Attendees: {', '.join(names)}")

    note = clean_note(detail.get("content"))
    if note:
        out += ["", "## Chris's note", note]

    summary = (detail.get("summary") or "").strip()
    if summary:
        out += ["", "## Summary (Wispr Flow)", summary]

    # Wispr wraps the transcript in its own prompt-injection guard rails; they
    # would read as instructions to the agents downstream.
    transcript = (detail.get("transcript") or "").strip()
    transcript = re.sub(r"^<<<[^\n]*>>>\s*", "", transcript)
    transcript = re.sub(r"\s*<<<END TRANSCRIPT>>>\s*$", "", transcript)
    if transcript:
        out += ["", "## Transcript", transcript]

    return "\n".join(out).strip() + "\n"


CONTINUATION = re.compile(r"\n*\(\.\.\.truncated[^)]*?start_char=(\d+)\.*\)")
GUARD_RAIL = re.compile(r"^<<<[^\n]*>>>\n?|\n?<<<[^\n]*>>>$")


def clean_page(page):
    """One page of transcript, without Wispr's wrapping.

    Wispr re-wraps every page in its own prompt-injection guard rails and
    appends a continuation marker; stitched together unmodified they would
    land in the middle of the note and read as instructions to the agents.
    """
    page = GUARD_RAIL.sub("", page.strip())
    return CONTINUATION.sub("", page).strip()


def next_offset(page):
    match = CONTINUATION.search(page)
    return int(match.group(1)) if match else None


def clean_note(raw):
    """Chris's own note, without Wispr's rendered summary underneath it."""
    note = (raw or "").strip()
    for boundary in (":::toggle", "## Flow Summary"):
        if boundary in note:
            note = note.split(boundary, 1)[0]
    return note.strip().strip("-").strip()


def load_state(path):
    path = Path(path)
    if not path.exists():
        return set()
    return {line.strip() for line in path.read_text().splitlines() if line.strip()}


def record_state(path, meeting_id):
    path = Path(path)
    if meeting_id in load_state(path):
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as fh:
        fh.write(meeting_id + "\n")


def needs_refresh(token, now=None):
    now = time.time() if now is None else now
    return token.get("expires_at", 0) - REFRESH_MARGIN <= now


# --- OAuth -------------------------------------------------------------------

def _post_form(url, fields):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(url, data=data, method="POST",
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        try:
            return json.loads(body)
        except json.JSONDecodeError:
            raise RuntimeError(f"{url} -> HTTP {exc.code}: {body[:300]}") from None


def _post_json(url, payload, headers=None):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), method="POST",
                                 headers={"Content-Type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read()), dict(resp.headers)


def save_token(token):
    CONFIG_DIR.mkdir(parents=True, exist_ok=True)
    TOKEN_FILE.write_text(json.dumps(token, indent=2))
    TOKEN_FILE.chmod(0o600)


def load_token():
    if not TOKEN_FILE.exists():
        raise SystemExit("No Wispr token. Run: ~/bin/wispr-sync auth")
    return json.loads(TOKEN_FILE.read_text())


def _store(payload, client_id):
    return {
        "client_id": client_id,
        "access_token": payload["access_token"],
        "refresh_token": payload.get("refresh_token", ""),
        "expires_at": time.time() + int(payload.get("expires_in", 3600)),
    }


def authorize_url(client_id, verifier, state):
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    query = urllib.parse.urlencode({
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": REDIRECT_URI,
        "scope": SCOPE,
        "state": state,
        "resource": MCP_URL,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    })
    return f"{AUTH_BASE}/oauth2/authorize?{query}"


def code_from_redirect(pasted, state):
    """Pull the auth code out of whatever Chris pasted back."""
    pasted = pasted.strip()
    if "?" not in pasted and "&" not in pasted:
        return pasted
    query = dict(urllib.parse.parse_qsl(urllib.parse.urlparse(pasted).query))
    if query.get("error"):
        raise ValueError(f"{query['error']}: {query.get('error_description', '')}")
    if query.get("state") != state:
        raise ValueError("state mismatch — start the auth again rather than trusting this redirect")
    if not query.get("code"):
        raise ValueError(f"no code in the pasted URL: {pasted[:120]}")
    return query["code"]


def authorise():
    """Auth code + PKCE.

    Wispr only enables its device flow for first-party clients, and the VPS
    has no browser, so Chris approves in his own browser and pastes the
    localhost URL it lands on (which will fail to load — that is fine, the
    code is in the address bar) back here. Once only: after this the refresh
    token keeps cron going.
    """
    reg, _ = _post_json(f"{AUTH_BASE}/oauth2/register", {
        "client_name": "vault wispr transcript sync",
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
        "scope": SCOPE,
    })
    client_id = reg["client_id"]
    verifier = base64.urlsafe_b64encode(os.urandom(48)).decode().rstrip("=")
    state = uuid.uuid4().hex

    print("\n1. Open this in your browser and approve:\n")
    print("   " + authorize_url(client_id, verifier, state))
    print("\n2. It will redirect to a localhost URL that fails to load. That is expected.")
    print("   Copy the whole address out of the bar and paste it here.\n")
    pasted = input("Redirected URL: ")

    payload = _post_form(f"{AUTH_BASE}/oauth2/token", {
        "grant_type": "authorization_code",
        "code": code_from_redirect(pasted, state),
        "redirect_uri": REDIRECT_URI,
        "client_id": client_id,
        "code_verifier": verifier,
        "resource": MCP_URL,
    })
    if "access_token" not in payload:
        raise SystemExit(f"Token exchange failed: {payload}")
    if not payload.get("refresh_token"):
        print("WARNING: no refresh token returned — cron will stop when this expires.")
    save_token(_store(payload, client_id))
    print(f"Authorised. Token saved to {TOKEN_FILE}")


def access_token():
    token = load_token()
    if not needs_refresh(token):
        return token["access_token"]
    if not token.get("refresh_token"):
        raise SystemExit("Wispr token expired and no refresh token. Run: ~/bin/wispr-sync auth")
    payload = _post_form(f"{AUTH_BASE}/oauth2/token", {
        "grant_type": "refresh_token", "refresh_token": token["refresh_token"],
        "client_id": token["client_id"], "resource": MCP_URL,
    })
    if "access_token" not in payload:
        raise SystemExit(f"Refresh failed ({payload.get('error')}). Run: ~/bin/wispr-sync auth")
    refreshed = _store(payload, token["client_id"])
    refreshed["refresh_token"] = refreshed["refresh_token"] or token["refresh_token"]
    save_token(refreshed)
    return refreshed["access_token"]


# --- MCP client --------------------------------------------------------------

class Mcp:
    def __init__(self, token):
        self.headers = {
            "Authorization": f"Bearer {token}",
            "Accept": "application/json, text/event-stream",
            "MCP-Protocol-Version": "2025-06-18",
        }
        self.session = None
        self._id = 0

    def _rpc(self, method, params=None, notify=False):
        body = {"jsonrpc": "2.0", "method": method}
        if params is not None:
            body["params"] = params
        if not notify:
            self._id += 1
            body["id"] = self._id

        req = urllib.request.Request(MCP_URL, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", **self.headers})
        with urllib.request.urlopen(req, timeout=120) as resp:
            if self.session is None:
                self.session = resp.headers.get("Mcp-Session-Id")
                if self.session:
                    self.headers["Mcp-Session-Id"] = self.session
            raw = resp.read().decode()

        if notify or not raw.strip():
            return None
        payload = _decode(raw)
        if "error" in payload:
            raise RuntimeError(f"{method}: {payload['error']}")
        return payload.get("result", {})

    def connect(self):
        self._rpc("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "vault-wispr-sync", "version": "1.0"},
        })
        self._rpc("notifications/initialized", notify=True)

    def call(self, tool, arguments):
        result = self._rpc("tools/call", {"name": tool, "arguments": arguments})
        for block in result.get("content", []):
            if block.get("type") == "text":
                try:
                    return json.loads(block["text"])
                except json.JSONDecodeError:
                    return {"text": block["text"]}
        return result.get("structuredContent", {})


def _decode(raw):
    """Streamable HTTP replies as plain JSON or as an SSE frame."""
    stripped = raw.lstrip()
    if stripped.startswith("{"):
        return json.loads(stripped)
    for line in raw.splitlines():
        if line.startswith("data:"):
            return json.loads(line[5:].strip())
    raise RuntimeError(f"Unparseable MCP response: {raw[:200]}")


def fetch_transcript(mcp, meeting_id):
    chunks, offset = [], 0
    while True:
        detail = mcp.call("get_meeting", {
            "meeting_id": meeting_id,
            "view_transcript": {"start_char": offset, "char_limit": TRANSCRIPT_PAGE},
        })
        part = detail.get("transcript") or ""
        chunks.append(clean_page(part))
        offset = next_offset(part)
        if offset is None:
            detail["transcript"] = "\n".join(c for c in chunks if c)
            return detail


# --- sync --------------------------------------------------------------------

def notify(message):
    """Tell Chris on Telegram, via Bella — she owns agent-ops health."""
    subprocess.run(
        ["bash", "-c",
         f'source ~/.secret_env && "{SEND_SH}" --bot-var BELLA_BOT_TOKEN '
         f'--source wispr-sync "$1"', "_", message],
        capture_output=True, timeout=60,
    )


def _load_alert():
    if not ALERT_FILE.exists():
        return None
    try:
        return json.loads(ALERT_FILE.read_text())
    except json.JSONDecodeError:
        return None


def should_alert(state, now=None):
    now = time.time() if now is None else now
    return not state or now - state.get("alerted_at", 0) >= ALERT_COOLDOWN


def fix_hint(exc):
    """What to do about this failure. Advice that does not match the cause
    sends whoever reads the alert down the wrong path — a transient 503 was
    once answered with a re-auth."""
    if isinstance(exc, urllib.error.HTTPError):
        if exc.code in (401, 403):
            return "Wispr rejected the token. Fix: run ~/bin/wispr-sync auth on the VPS."
        if exc.code >= 500:
            return (f"Wispr's server is unreachable (HTTP {exc.code}). Nothing to fix here: "
                    "the sync retries every 20 minutes and will report when it recovers.")
    if isinstance(exc, (urllib.error.URLError, TimeoutError, ConnectionError)):
        return ("Wispr is unreachable from the VPS. Nothing to fix here: the sync retries "
                "every 20 minutes and will report when it recovers.")
    if isinstance(exc, SystemExit):
        return "The token could not be refreshed. Fix: run ~/bin/wispr-sync auth on the VPS."
    return f"Unexpected failure. Check the log: {LOG_FILE}"


def _alert_broken(reason, exc):
    state = _load_alert()
    first_failure = state is None
    if should_alert(state):
        opener = "Wispr transcript sync has stopped working" if first_failure \
            else "Wispr transcript sync is still down"
        notify(f"{opener} — no meeting transcripts are reaching the vault.\n\n"
               f"{reason}\n\n{fix_hint(exc)}")
        ALERT_FILE.parent.mkdir(parents=True, exist_ok=True)
        ALERT_FILE.write_text(json.dumps({"alerted_at": time.time(), "reason": reason}))


def _alert_recovered():
    if _load_alert() is None:
        return
    notify("Wispr transcript sync is working again — meetings are reaching the vault.")
    ALERT_FILE.unlink(missing_ok=True)


def log(message):
    LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with LOG_FILE.open("a") as fh:
        fh.write(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {message}\n")


def sync():
    if not TOKEN_FILE.exists():
        # Cron runs regardless of whether Chris has authorised yet; wait quietly
        # rather than failing loudly every 20 minutes.
        log("Not authorised yet — run: ~/bin/wispr-sync auth")
        return 0

    try:
        written = _sync_once()
    except (Exception, SystemExit) as exc:
        # Cron is the only thing watching. A sync that dies quietly means
        # transcripts stop arriving and nobody notices for weeks.
        reason = f"{type(exc).__name__}: {exc}"
        log(f"ERROR: {reason}")
        _alert_broken(reason, exc)
        return 0

    _alert_recovered()
    return written


def _sync_once():
    TRANSCRIPTS.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc)
    seen = load_state(STATE_FILE)

    mcp = Mcp(access_token())
    mcp.connect()
    listing = mcp.call("search_meetings", {
        "since": (now - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "limit": 50,
    })

    existing = [p.name for p in TRANSCRIPTS.glob("*.md")]
    written = 0

    for meeting in listing.get("meetings", []):
        if meeting["id"] in seen:
            continue
        if not is_ready(meeting, now.strftime("%Y-%m-%dT%H:%M:%SZ")):
            continue

        duplicate = existing_match(meeting, existing)
        if duplicate:
            log(f"SKIP {meeting['title']!r} — vault already has {duplicate}")
            record_state(STATE_FILE, meeting["id"])
            continue

        detail = fetch_transcript(mcp, meeting["id"])
        detail.setdefault("title", meeting.get("title"))
        detail.setdefault("start", meeting.get("start"))
        detail.setdefault("end", meeting.get("end"))

        name = filename_for(meeting)
        (TRANSCRIPTS / name).write_text(render(detail))
        existing.append(name)
        record_state(STATE_FILE, meeting["id"])
        log(f"Downloaded: {name}")
        written += 1

    log(f"Downloaded {written} new transcript(s) — vault-sync will commit and route"
        if written else "OK")
    return written


def status():
    if TOKEN_FILE.exists():
        token = json.loads(TOKEN_FILE.read_text())
        left = int(token.get("expires_at", 0) - time.time())
        print(f"token: {'valid' if left > 0 else 'expired'} "
              f"({abs(left) // 60} min {'left' if left > 0 else 'ago'}), "
              f"refresh token: {'yes' if token.get('refresh_token') else 'NO'}")
    else:
        print(f"token: absent ({TOKEN_FILE})")
    print(f"synced meetings: {len(load_state(STATE_FILE))}")
    if LOG_FILE.exists():
        print("last log: " + LOG_FILE.read_text().strip().splitlines()[-1])


def main(argv):
    command = argv[1] if len(argv) > 1 else "sync"
    if command == "auth":
        authorise()
    elif command == "sync":
        sync()
    elif command == "status":
        status()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
