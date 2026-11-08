"""Scheduled collector. Never print credentials or product payloads."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from urllib.request import Request, build_opener, HTTPRedirectHandler
from urllib.error import HTTPError

ROOT = Path(__file__).resolve().parent.parent
ORIGIN = os.environ["COLLECTION_ORIGIN"].rstrip("/")
if not ORIGIN.startswith("https://"):
    raise ValueError("HTTPS collection origin required")
class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

OPENER = build_opener(NoRedirect)
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

def request(path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    try:
        with OPENER.open(Request(ORIGIN + "/api/" + path, data=data, headers=HEADERS), timeout=90) as response:
            if "application/json" not in response.headers.get("Content-Type", ""):
                raise RuntimeError("API returned a login page instead of JSON; check the Access Service Auth policy")
            print("Cloudflare Access credential pair: ACCEPTED (request reached Worker)", flush=True)
            return json.load(response)
    except HTTPError as error:
        content_type = error.headers.get("Content-Type", "unknown")
        code = ""
        response_hint = ""
        try:
            error_body = error.read(4096).decode("utf-8", "replace")
            if "application/json" in content_type:
                code = json.loads(error_body).get("error", "")
            else:
                candidate = " ".join(error_body.split())[:120]
                if candidate and all(ch.isalnum() or ch in " ._:-" for ch in candidate):
                    response_hint = candidate
        except (ValueError, AttributeError):
            pass
        safe_codes = {"UNAUTHORIZED", "FORBIDDEN", "INVALID_ORIGIN", "VALIDATION", "PAYLOAD_TOO_LARGE"}
        detail = code if code in safe_codes else "Access/edge rejected request; check service token policy and Access logs"
        content_type = error.headers.get("Content-Type", "unknown")
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
        raise RuntimeError(
            f"API {path}: HTTP {error.code}; {detail}; "
            f"server={server}; content_type={content_type}; cf_ray={cf_ray}; "
            f"redirect_host={redirect_host or 'none'}; response_hint={response_hint or 'none'}"
        ) from None

def main():
    # Temporary safe diagnostic: compare only the known v2 ID prefix; never print credential values.
    print("Access client ID matches v2:", os.environ["CF_ACCESS_CLIENT_ID"].startswith("c2bcf43c"), flush=True)
    rules = request("settings/keywords")
    categories = json.loads((ROOT / "src/shared/collectionCategories.json").read_text())
    failures = []
    for category in categories:
        run_id = None
        try:
            result = subprocess.run([sys.executable, "scripts/collect-rankings.py", "--category", category],
                input=json.dumps(rules), text=True, encoding="utf-8", capture_output=True, cwd=ROOT, timeout=7200)
            if result.returncode:
                raise RuntimeError("Browser collection failed; no snapshot published")
            line = next(line for line in result.stdout.splitlines() if line.startswith("COSMETICS_RANK_CAPTURE "))
            capture = json.loads(line.split(" ", 1)[1])
            rows = [{**row, "ranking_date": capture["ranking_date"], "category_code": category} for row in capture["rows"]]
            if len(rows) != 100 or len({r["product_id"] for r in rows}) != 100 or {r["rank"] for r in rows} != set(range(1, 101)):
                raise ValueError("Invalid ranking snapshot")
            run = request("imports", {"ranking_date": capture["ranking_date"], "category_code": category,
                "collected_at": capture["collected_at"], "source_type": "MANUAL", "replace": True,
                "source_ref": "selenium:github:" + hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()})
            run_id = run["id"]
            if not run.get("already_complete"):
                for row in rows:
                    request(f"imports/{run_id}/chunks", {"rows": [row]})
                request(f"imports/{run_id}/complete", {"replace": True})
            print(f"{category}: saved 100 rows", flush=True)
        except Exception as error:
            if run_id:
                try:
                    request(f"imports/{run_id}/cancel", {"failed": True})
                except Exception:
                    pass
            print(f"{category}: failed ({type(error).__name__})", flush=True)
            failures.append(category)
    if failures:
        raise SystemExit("Failed categories: " + ", ".join(failures))

if __name__ == "__main__":
    main()
