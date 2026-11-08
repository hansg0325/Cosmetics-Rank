"""Public aggregate review enrichment with a short product-ID cache."""
import json
import math
import re
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def valid_summary(row):
    count, rating = row.get("review_count"), row.get("rating")
    return type(count) is int and 0 <= count <= 1_000_000_000 and (
        rating is None and count == 0 or type(rating) in (int, float) and math.isfinite(rating) and 0 <= rating <= 5
    )


def enrich_reviews(driver, rows):
    cache_file = ROOT / ".local-browser/review-summary-cache.json"
    try:
        cache = json.loads(cache_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    now = time.time()
    cache = {key: value for key, value in cache.items() if isinstance(value, dict) and valid_summary(value) and 0 <= now - value.get("checked_at", 0) < 900}
    missing = [row["product_id"] for row in rows if row["product_id"] not in cache]
    cooldown_file = ROOT / ".local-browser/review-cooldown.json"
    try:
        if time.time() < json.loads(cooldown_file.read_text(encoding="utf-8")).get("until", 0):
            missing = []
    except (OSError, ValueError):
        pass
    script = Path(__file__).with_suffix(".js").read_text(encoding="utf-8")
    driver.set_script_timeout(40)
    started = time.monotonic()
    failures = 0
    diagnostics = []
    for offset in range(0, len(missing), 10):
        if time.monotonic() - started > 135 or failures >= 3:
            break
        requested = missing[offset:offset + 10]
        try:
            results = driver.execute_async_script(script, requested)
        except Exception as error:
            diagnostics.append({"error": type(error).__name__})
            break
        diagnostics.extend(results)
        blocked = next((result.get("error", "") for result in results if "HTTP 429" in result.get("error", "")), None)
        if blocked:
            wait = re.search(r"retry-after=(\d+)", blocked)
            cooldown_file.parent.mkdir(parents=True, exist_ok=True)
            cooldown_file.write_text(json.dumps({"until": time.time() + max(60, int(wait.group(1)) if wait else 60)}), encoding="utf-8")
        for result in results:
            if result.get("product_id") in requested and valid_summary(result):
                cache[result["product_id"]] = {"rating": result["rating"], "review_count": result["review_count"], "checked_at": time.time()}
                failures = 0
            else:
                failures += 1
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    (cache_file.parent / "review-diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False), encoding="utf-8")
    cache_file.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    for row in rows:
        value = cache.get(row["product_id"], {})
        row["rating"] = value.get("rating")
        row["review_count"] = value.get("review_count")
