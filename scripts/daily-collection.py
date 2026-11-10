"""Scheduled collector. Never print credentials or product payloads."""
import hashlib
import argparse
import http.client
import json
import os
import socket
import subprocess
import sys
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError, URLError

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = os.environ["COLLECTION_ORIGIN"].rstrip("/")
CATEGORY_INTERVAL_SECONDS = 10
API_REQUEST_TIMEOUT_SECONDS = 90
API_REQUEST_ATTEMPTS = 3
API_REQUEST_RETRY_DELAYS = (5, 15)
SNAPSHOT_SAVE_ATTEMPTS = 2
ACCESS_ACCEPTANCE_LOGGED = False
if not ORIGIN.startswith("https://"):
    raise ValueError("HTTPS collection origin required")
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = build_opener(NoRedirect)
TRANSIENT_HTTP_STATUSES = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524}
HEADERS = {
    # Cloudflare Browser Integrity Check blocks urllib's default Python User-Agent
    # on workers.dev; identify this scheduled client explicitly.
    "User-Agent": "CosmeticsRankCollector/1.0 (+https://github.com/hansg0325/Cosmetics-Rank)",
    "Authorization": "Bearer " + os.environ["COLLECTION_API_KEY"],
    "CF-Access-Client-Id": os.environ["CF_ACCESS_CLIENT_ID"],
    "CF-Access-Client-Secret": os.environ["CF_ACCESS_CLIENT_SECRET"],
    "Origin": ORIGIN,
    "Content-Type": "application/json",
}

class TransientAPIError(RuntimeError):
    """An API request failed after bounded retries and may succeed on replay."""

class TransientCollectionError(RuntimeError):
    """Browser collection failed with a retryable navigation timeout."""

def request_retry_delay(attempt, retry_after=None):
    default = API_REQUEST_RETRY_DELAYS[min(attempt - 1, len(API_REQUEST_RETRY_DELAYS) - 1)]
    try:
        requested = int(retry_after)
    except (TypeError, ValueError):
        try:
            retry_at = parsedate_to_datetime(retry_after or "")
            if retry_at is None:
                return default
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            requested = int((retry_at - datetime.now(timezone.utc)).total_seconds())
        except (AttributeError, TypeError, ValueError, OverflowError):
            return default
    return min(60, max(default, requested))

def request(path, body=None):
    global ACCESS_ACCEPTANCE_LOGGED
    data = json.dumps(body).encode() if body is not None else None
    method = "POST" if data is not None else "GET"
    for attempt in range(1, API_REQUEST_ATTEMPTS + 1):
        started = time.monotonic()
        print(f"[api] {method} /api/{path} attempt {attempt}/{API_REQUEST_ATTEMPTS} started", flush=True)
        try:
            with OPENER.open(
                Request(ORIGIN + "/api/" + path, data=data, headers=HEADERS),
                timeout=API_REQUEST_TIMEOUT_SECONDS,
            ) as response:
                content_type = response.headers.get("Content-Type", "")
                if "application/json" not in content_type:
                    elapsed = time.monotonic() - started
                    print(
                        f"[api] {method} /api/{path} failed after {elapsed:.1f}s: unexpected content type",
                        flush=True,
                    )
                    raise RuntimeError("API returned a login page instead of JSON; check the Access Service Auth policy")
                if not ACCESS_ACCEPTANCE_LOGGED:
                    print("Cloudflare Access credential pair: ACCEPTED (request reached Worker)", flush=True)
                    ACCESS_ACCEPTANCE_LOGGED = True
                result = json.load(response)
                elapsed = time.monotonic() - started
                print(f"[api] {method} /api/{path} succeeded HTTP {response.status} in {elapsed:.1f}s", flush=True)
                return result
        except HTTPError as error:
            elapsed = time.monotonic() - started
            content_type = error.headers.get("Content-Type", "unknown")
            code = ""
            response_hint = ""
            if error.code not in TRANSIENT_HTTP_STATUSES:
                try:
                    error_body = error.read(4096).decode("utf-8", "replace")
                    if "application/json" in content_type:
                        code = json.loads(error_body).get("error", "")
                    else:
                        candidate = " ".join(error_body.split())[:120]
                        if candidate and all(ch.isalnum() or ch in " ._:-" for ch in candidate):
                            response_hint = candidate
                except (ValueError, AttributeError, OSError, http.client.HTTPException):
                    pass
            safe_codes = {"UNAUTHORIZED", "FORBIDDEN", "INVALID_ORIGIN", "VALIDATION", "PAYLOAD_TOO_LARGE"}
            detail = code if code in safe_codes else "Access/edge rejected request; check service token policy and Access logs"
            cf_ray = error.headers.get("CF-Ray", "missing")
            server = error.headers.get("Server", "missing")
            location = error.headers.get("Location", "")
            redirect_host = ""
            if location:
                from urllib.parse import urlsplit
                redirect_host = urlsplit(location).netloc
            if error.code in {301, 302, 303, 307, 308} and redirect_host.endswith("cloudflareaccess.com"):
                print("Cloudflare Access credential pair: REJECTED (redirected to Access login; secret value not logged)", flush=True)
            elif code in safe_codes:
                print(f"Cloudflare Access credential pair: ACCEPTED (Worker API responded with {code}; secret value not logged)", flush=True)
            else:
                print(f"Cloudflare Access credential pair: NOT CONFIRMED (HTTP {error.code}; see response metadata)", flush=True)
            message = (
                f"API {path}: HTTP {error.code}; {detail}; "
                f"server={server}; content_type={content_type}; cf_ray={cf_ray}; "
                f"redirect_host={redirect_host or 'none'}; response_hint={response_hint or 'none'}"
            )
            if error.code in TRANSIENT_HTTP_STATUSES:
                print(f"[api] {method} /api/{path} transient HTTP {error.code} after {elapsed:.1f}s", flush=True)
                if attempt < API_REQUEST_ATTEMPTS:
                    delay = request_retry_delay(attempt, error.headers.get("Retry-After"))
                    print(f"[api] retrying /api/{path} in {delay}s", flush=True)
                    time.sleep(delay)
                    continue
                print(f"[api] {method} /api/{path} exhausted retries after {elapsed:.1f}s", flush=True)
                raise TransientAPIError(message) from None
            print(f"[api] {method} /api/{path} failed HTTP {error.code} after {elapsed:.1f}s", flush=True)
            raise RuntimeError(message) from None
        except (URLError, TimeoutError, socket.timeout, ConnectionError, http.client.HTTPException, json.JSONDecodeError) as error:
            elapsed = time.monotonic() - started
            reason = getattr(error, "reason", None)
            error_name = type(reason).__name__ if reason is not None else type(error).__name__
            print(
                f"[api] {method} /api/{path} transient transport failure ({error_name}) after {elapsed:.1f}s",
                flush=True,
            )
            if attempt < API_REQUEST_ATTEMPTS:
                delay = request_retry_delay(attempt)
                print(f"[api] retrying /api/{path} in {delay}s", flush=True)
                time.sleep(delay)
                continue
            print(f"[api] {method} /api/{path} exhausted retries after {elapsed:.1f}s", flush=True)
            raise TransientAPIError(
                f"API {path}: transient {error_name} after {API_REQUEST_ATTEMPTS} attempts"
            ) from None

def collect_category(category, rules, categories):
    result = subprocess.run(
        [sys.executable, "-u", "scripts/collect-rankings.py", "--category", category],
        input=json.dumps(rules), text=True, encoding="utf-8", capture_output=True,
        cwd=ROOT, timeout=7200,
    )
    output_lines = result.stdout.splitlines()
    for line in output_lines:
        if not line.startswith("COSMETICS_RANK_CAPTURE "):
            print(f"[{category}] {line}", flush=True)
    if result.returncode:
        for line in result.stderr.splitlines():
            print(f"[{category}] stderr: {line}", flush=True)
        error_line = next(
            (line for line in output_lines if line.startswith("COSMETICS_RANK_ERROR ")), ""
        )
        if error_line:
            diagnostic = json.loads(error_line.split(" ", 1)[1])
            message = (
                "Browser collection failed; no snapshot published; "
                f"request_type={diagnostic.get('request_type') or 'category_ranking_list'}; "
                f"category_code={diagnostic.get('category_code') or category}; "
                f"category_name={diagnostic.get('category_name') or categories[category]['name']}; "
                f"stage={diagnostic.get('stage') or 'unknown'}; "
                f"requested_url={diagnostic.get('requested_url') or 'unknown'}; "
                f"final_url={diagnostic.get('final_url') or 'unknown'}; "
                f"document_response={json.dumps(diagnostic.get('document_response'), ensure_ascii=False)}; "
                f"page_title={diagnostic.get('page_title') or 'empty'}; "
                f"page_excerpt={diagnostic.get('page_excerpt') or 'empty'}; "
                f"products={diagnostic.get('product_count', 0)}; "
                f"category_matches={diagnostic.get('category_matches')}; "
                f"browser_version={diagnostic.get('browser_version') or 'unknown'}; "
                f"effective_user_agent={diagnostic.get('effective_user_agent') or 'unknown'}; "
                f"challenge_indicators={json.dumps(diagnostic.get('challenge_indicators') or {}, ensure_ascii=False)}; "
                f"navigation_timed_out={diagnostic.get('navigation_timed_out', False)}; "
                f"error_type={diagnostic.get('error_type') or 'none'}; "
                f"error={diagnostic.get('error') or 'none'}"
            )
            challenge_indicators = diagnostic.get("challenge_indicators") or {}
            page_text = (
                str(diagnostic.get("page_title", "")) + " " +
                str(diagnostic.get("page_excerpt", ""))
            ).lower()
            challenge_seen = (
                any(value is True for value in challenge_indicators.values())
                or "just a moment" in page_text
                or "잠시만 기다려" in page_text
            )
            if diagnostic.get("navigation_timed_out") and not challenge_seen:
                raise TransientCollectionError(message)
            raise RuntimeError(message)
        raise RuntimeError("Browser collection failed; no diagnostic marker; no snapshot published")

    capture_line = next(
        (line for line in output_lines if line.startswith("COSMETICS_RANK_CAPTURE ")), None
    )
    if not capture_line:
        raise RuntimeError("Browser collector exited successfully without a capture marker")
    return json.loads(capture_line.split(" ", 1)[1])

def save_snapshot(category, capture, rows):
    source_ref = "selenium:github:" + hashlib.sha256(
        json.dumps(rows, sort_keys=True).encode()
    ).hexdigest()
    start_payload = {
        "ranking_date": capture["ranking_date"],
        "category_code": category,
        "collected_at": capture["collected_at"],
        "source_type": "MANUAL",
        "replace": True,
        "source_ref": source_ref,
    }
    if capture.get("detail_summary") is not None:
        start_payload["detail_summary"] = capture["detail_summary"]
    run_ids = set()
    for save_attempt in range(1, SNAPSHOT_SAVE_ATTEMPTS + 1):
        run_id = None
        try:
            run = request("imports", start_payload)
            run_id = run["id"]
            run_ids.add(run_id)
            if not run.get("already_complete"):
                for offset in range(0, len(rows), 20):
                    request(f"imports/{run_id}/chunks", {"rows": rows[offset:offset + 20]})
                request(f"imports/{run_id}/complete", {"replace": True})
            return
        except TransientAPIError:
            if save_attempt < SNAPSHOT_SAVE_ATTEMPTS:
                print(
                    f"[{category}] transient save failure; retrying this snapshot "
                    f"({save_attempt + 1}/{SNAPSHOT_SAVE_ATTEMPTS}) in 15s",
                    flush=True,
                )
                time.sleep(15)
                continue
            print(
                f"[{category}] leaving any incomplete import resumable for the next run",
                flush=True,
            )
            raise
        except Exception:
            for failed_run_id in run_ids:
                try:
                    request(f"imports/{failed_run_id}/cancel", {"failed": True})
                    print(f"[{category}] marked incomplete import {failed_run_id} as failed", flush=True)
                except Exception as cancel_error:
                    print(
                        f"[{category}] could not mark import {failed_run_id} as failed: "
                        f"{type(cancel_error).__name__}: {cancel_error}",
                        flush=True,
                    )
            raise

def main():
    # Temporary safe diagnostic: compare only the known v2 ID prefix; never print credential values.
    print("Access client ID matches v2:", os.environ["CF_ACCESS_CLIENT_ID"].startswith("c2bcf43c"), flush=True)
    rules = request("settings/keywords")
    categories = json.loads((ROOT / "src/shared/collectionCategories.json").read_text(encoding="utf-8"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--category", choices=["all", *categories],
                        default=os.environ.get("COLLECTION_CATEGORY", "all"))
    selected_category = parser.parse_args().category
    failures = []
    category_codes = list(categories) if selected_category == "all" else [selected_category]
    for category_index, category in enumerate(category_codes):
        try:
            capture = None
            for collection_attempt in range(1, 3):
                try:
                    capture = collect_category(category, rules, categories)
                    break
                except TransientCollectionError:
                    if collection_attempt == 2:
                        raise
                    print(
                        f"[{category}] navigation timed out; retrying collection "
                        f"({collection_attempt + 1}/2) in 15s",
                        flush=True,
                    )
                    time.sleep(15)
            rows = [{**row, "ranking_date": capture["ranking_date"], "category_code": category} for row in capture["rows"]]
            if len(rows) != 100 or len({r["product_id"] for r in rows}) != 100 or {r["rank"] for r in rows} != set(range(1, 101)):
                raise ValueError("Invalid ranking snapshot")
            save_snapshot(category, capture, rows)
            print(f"{category}: saved 100 rows", flush=True)
        except Exception as error:
            print(f"{category}: failed ({type(error).__name__}): {error}", flush=True)
            failures.append(category)
        if category_index < len(category_codes) - 1:
            print(f"Waiting {CATEGORY_INTERVAL_SECONDS}s before the next category", flush=True)
            time.sleep(CATEGORY_INTERVAL_SECONDS)
    if failures:
        raise SystemExit("Failed categories: " + ", ".join(failures))

if __name__ == "__main__":
    main()
