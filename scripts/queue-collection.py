"""Read Cloudflare Queue jobs and run the existing collector on this PC."""

import argparse
import base64
import ctypes
import getpass
import json
import os
import re
import sqlite3
import subprocess
import sys
from contextlib import closing
from ctypes import wintypes
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request, build_opener


ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))
COLLECTION_ORIGIN = "https://cosmetics-rank.hansg0325.workers.dev"
UPLOAD_SECRETS = ("COLLECTION_API_KEY", "CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET")
QUEUE_SECRET = "CLOUDFLARE_QUEUES_TOKEN"
API_TIMEOUT = 20
COLLECTOR_TIMEOUT = 5 * 60 * 60
LEASE_MS = 2 * 60 * 1000


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


OPENER = build_opener(NoRedirect)


class DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]


def protect(data, *, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("The configuration uses Windows user encryption and must be opened on its original PC")
    crypt32 = ctypes.WinDLL("crypt32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    blob_ptr = ctypes.POINTER(DataBlob)
    function.argtypes = [blob_ptr, ctypes.c_void_p, blob_ptr, ctypes.c_void_p,
                         ctypes.c_void_p, wintypes.DWORD, blob_ptr]
    function.restype = wintypes.BOOL
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source = DataBlob(len(data), buffer)
    output = DataBlob()
    # CRYPTPROTECT_UI_FORBIDDEN; protection is tied to this Windows account.
    if not function(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(output)):
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return ctypes.string_at(output.pbData, output.cbData)
    finally:
        if output.pbData:
            kernel32.LocalFree(output.pbData)


def validate_id(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-fA-F0-9]{32}", value):
        raise ValueError("Expected a 32-character Cloudflare account or queue ID")
    return value.lower()


def validate_queue_token(value):
    if not re.fullmatch(r"(?:cf(?:ut|at)_[A-Za-z0-9]{48}|[A-Za-z0-9_-]{40})", value):
        raise ValueError("Invalid Cloudflare queue token. Paste only the API token; keyboard control characters are not accepted.")
    return value


def default_config():
    return Path(os.environ.get("LOCALAPPDATA", str(Path.home()))) / "CosmeticsRank" / "queue-collector.json"


def configure(path, account_id, queue_id, smoke_only):
    if not sys.stdin.isatty():
        raise RuntimeError("Open an interactive Windows terminal to enter the credentials")
    account_id = validate_id(account_id)
    queue_id = validate_id(queue_id)
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    secrets = previous.get("protected", {}).copy()
    for name in (QUEUE_SECRET,) if smoke_only else (QUEUE_SECRET, *UPLOAD_SECRETS):
        hint = " (Enter to keep the saved value)" if name in secrets else ""
        value = getpass.getpass(f"{name}{hint}: ").strip()
        if value:
            if name == QUEUE_SECRET:
                validate_queue_token(value)
            secrets[name] = base64.b64encode(protect(value.encode())).decode("ascii")
        elif name not in secrets:
            raise ValueError(f"{name} is required")
        elif name == QUEUE_SECRET:
            validate_queue_token(protect(base64.b64decode(secrets[name], validate=True), decrypt=True).decode())
    config = {"account_id": account_id, "queue_id": queue_id, "protected": secrets}
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    temporary.replace(path)
    print(f"Saved encrypted configuration: {path}")


def load_config(path):
    config = json.loads(path.read_text(encoding="utf-8"))
    account_id = validate_id(config["account_id"])
    queue_id = validate_id(config["queue_id"])
    values = {name: protect(base64.b64decode(value, validate=True), decrypt=True).decode()
              for name, value in config["protected"].items()
              if name in (QUEUE_SECRET, *UPLOAD_SECRETS)}
    return account_id, queue_id, values


class Queue:
    def __init__(self, account_id, queue_id, token):
        self.url = f"https://api.cloudflare.com/client/v4/accounts/{account_id}/queues/{queue_id}/messages"
        self.token = validate_queue_token(token)

    def request(self, action, payload):
        request = Request(f"{self.url}/{action}", data=json.dumps(payload).encode(), method="POST",
                          headers={"Authorization": f"Bearer {self.token}", "Content-Type": "application/json",
                                   "User-Agent": "CosmeticsRankQueueCollector/1.0"})
        try:
            with OPENER.open(request, timeout=API_TIMEOUT) as response:
                body = json.load(response)
        except HTTPError as error:
            raise RuntimeError(f"Cloudflare Queue {action}: HTTP {error.code}") from None
        if not body.get("success") or not isinstance(body.get("result"), dict):
            raise RuntimeError(f"Cloudflare Queue {action} returned an unsuccessful response")
        return body["result"]

    def pull(self):
        return self.request("pull", {"batch_size": 1, "visibility_timeout_ms": LEASE_MS}).get("messages", [])

    def ack(self, lease):
        result = self.request("ack", {"acks": [{"lease_id": lease}], "retries": []})
        if result.get("ackCount") != 1:
            raise RuntimeError("Cloudflare did not acknowledge the queue message")

    def retry(self, lease):
        result = self.request("ack", {"acks": [], "retries": [{"lease_id": lease, "delay_seconds": 600}]})
        if result.get("retryCount") != 1:
            raise RuntimeError("Cloudflare did not return the queue message for retry")


def parse_job(message):
    body = message["body"]
    if isinstance(body, str):
        content_type = (message.get("metadata") or {}).get("CF-Content-Type")
        if content_type in ("json", "bytes") and not body.lstrip().startswith("{"):
            body = base64.b64decode(body, validate=True)
        body = json.loads(body)
    if not isinstance(body, dict) or body.get("version") != 1:
        raise ValueError("Unexpected queue message version")
    mode = body.get("mode")
    timestamp = body.get("scheduledAt")
    if mode not in ("smoke", "collection") or not isinstance(timestamp, str) or len(timestamp) > 30:
        raise ValueError("Invalid queue job")
    scheduled_at = datetime.fromisoformat(timestamp)
    job_id = f"{mode}:{timestamp}"
    if scheduled_at.utcoffset() != timedelta(0) or body.get("jobId") != job_id:
        raise ValueError("Invalid queue job timestamp or ID")
    return job_id, mode, scheduled_at


def log(event, job_id=None, **fields):
    print(json.dumps({"time": datetime.now(KST).isoformat(timespec="seconds"),
                      "event": event, "jobId": job_id, **fields}), flush=True)


def run_collection(values):
    child_env = {**os.environ, **{name: values[name] for name in UPLOAD_SECRETS},
                 "COLLECTION_ORIGIN": COLLECTION_ORIGIN, "PYTHONIOENCODING": "utf-8"}
    try:
        result = subprocess.run([sys.executable, "-u", "scripts/daily-collection.py", "--category", "all"],
                                cwd=ROOT, env=child_env, timeout=COLLECTOR_TIMEOUT,
                                stdin=subprocess.DEVNULL, stdout=sys.stdout, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        return result.returncode
    except subprocess.TimeoutExpired:
        return 124


def lock_jobs(database):
    try:
        database.execute("BEGIN IMMEDIATE")
        return True
    except sqlite3.OperationalError as error:
        if error.sqlite_errorcode == sqlite3.SQLITE_BUSY:
            return False
        raise


def job_expired(mode, scheduled_at):
    now = datetime.now(KST)
    return (scheduled_at.astimezone(KST).date() != now.date() or
            scheduled_at > now + timedelta(minutes=2) or
            (mode == "smoke" and now - scheduled_at > timedelta(minutes=20)))


def missing_upload_credentials(mode, values):
    return mode == "collection" and any(not values.get(name) for name in UPLOAD_SECRETS)


def run_pending(database, values, job_id, *, resumed):
    # Keep the write lock while the child is running, so another poll cannot run it concurrently.
    pending = database.execute(
        "SELECT mode, scheduled_at FROM pending_jobs WHERE id = ?", (job_id,),
    ).fetchone()
    if not pending:
        return 0
    mode, scheduled_at = pending
    if job_expired(mode, datetime.fromisoformat(scheduled_at)):
        database.execute("DELETE FROM pending_jobs WHERE id = ?", (job_id,))
        database.commit()
        log("queue_job_expired", job_id)
        return 0
    if missing_upload_credentials(mode, values):
        log("collection_credentials_missing", job_id)
        return 1
    log("queue_job_resumed" if resumed else "queue_job_started", job_id)
    exit_code = run_collection(values) if mode == "collection" else 0
    database.execute("INSERT INTO jobs (id, exit_code) VALUES (?, ?)", (job_id, exit_code))
    database.execute("DELETE FROM pending_jobs WHERE id = ?", (job_id,))
    database.commit()
    log("queue_job_failed" if exit_code else "queue_job_completed", job_id, exitCode=exit_code)
    return exit_code


def poll(path):
    account_id, queue_id, values = load_config(path)
    with closing(sqlite3.connect(path.parent / "queue-jobs.sqlite3", timeout=0.5)) as database:
        database.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, exit_code INTEGER NOT NULL)")
        database.execute("""CREATE TABLE IF NOT EXISTS pending_jobs (
            id TEXT PRIMARY KEY, mode TEXT NOT NULL, scheduled_at TEXT NOT NULL
        )""")
        if not lock_jobs(database):
            return 0
        pending = database.execute("SELECT id FROM pending_jobs ORDER BY scheduled_at LIMIT 1").fetchone()
        if pending:
            return run_pending(database, values, pending[0], resumed=True)

        queue = Queue(account_id, queue_id, values[QUEUE_SECRET])
        messages = queue.pull()
        if not messages:
            return 0
        message = messages[0]
        lease = message["lease_id"]
        try:
            job_id, mode, scheduled_at = parse_job(message)
        except (ValueError, KeyError, TypeError):
            log("queue_message_discarded", reason="invalid job")
            queue.ack(lease)
            return 1

        if job_expired(mode, scheduled_at):
            log("queue_job_expired", job_id)
            queue.ack(lease)
            return 0

        if database.execute("SELECT 1 FROM jobs WHERE id = ?", (job_id,)).fetchone():
            log("queue_job_already_processed", job_id)
            queue.ack(lease)
            return 0

        if missing_upload_credentials(mode, values):
            log("collection_credentials_missing", job_id)
            queue.retry(lease)
            return 1

        # Persist the job on this PC before removing it from the queue. A restart can then resume it.
        database.execute("INSERT INTO pending_jobs (id, mode, scheduled_at) VALUES (?, ?, ?)",
                         (job_id, mode, scheduled_at.isoformat()))
        database.commit()
        queue.ack(lease)
        if not lock_jobs(database):
            return 0
        return run_pending(database, values, job_id, resumed=False)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, default=default_config())
    parser.add_argument("--configure", action="store_true")
    parser.add_argument("--account-id")
    parser.add_argument("--queue-id")
    parser.add_argument("--smoke-only", action="store_true")
    args = parser.parse_args()
    try:
        if args.configure:
            if not args.account_id or not args.queue_id:
                parser.error("--configure requires --account-id and --queue-id")
            configure(args.config, args.account_id, args.queue_id, args.smoke_only)
            return 0
        return poll(args.config)
    except (OSError, ValueError, KeyError, RuntimeError, sqlite3.Error) as error:
        log("queue_collector_error", error=str(error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
