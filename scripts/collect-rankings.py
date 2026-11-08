"""One isolated Selenium run; stdout marker is consumed by local collector."""
import importlib.util
import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

if not sys.stdin.isatty():
    rules_input = sys.stdin.read()
    if rules_input.strip():
        os.environ["COSMETICS_RANK_KEYWORD_RULES"] = rules_input

spec = importlib.util.spec_from_file_location("selenium_probe", Path(__file__).with_name("probe-selenium.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
categories = json.loads((Path(__file__).resolve().parent.parent / "src/shared/collectionCategories.json").read_text(encoding="utf-8"))
parser = argparse.ArgumentParser()
parser.add_argument("--category", choices=list(categories), default="overall")
category = parser.parse_args().category
source = categories[category]["source_url"]
result = module.probe("overall", source, os.environ.get("COSMETICS_RANK_CHROME_BINARY"))
if not result.get("valid"):
    print("COSMETICS_RANK_ERROR " + json.dumps({
        "message": categories[category]["name"] + " 랭킹 100개 또는 선택된 카테고리를 확인하지 못했습니다.",
        "page_title": result.get("page_title", result.get("title", "")),
        "product_count": result.get("product_count", 0),
        "category_matches": result.get("category_matches"),
        "stage": result.get("stage", ""),
        "requested_url": result.get("requested_url", source),
        "final_url": result.get("final_url", ""),
        "document_response": result.get("document_response"),
        "page_excerpt": result.get("page_excerpt", ""),
        "browser_version": result.get("browser_version", ""),
        "effective_user_agent": result.get("effective_user_agent", ""),
        "navigation_timed_out": result.get("navigation_timed_out", False),
        "error_type": result.get("error_type", ""),
        "error": result.get("error", "")[:500],
    }, ensure_ascii=False), flush=True)
    sys.exit(2)
now = datetime.now(timezone.utc)
capture = {"format": "cosmetics-rank-browser-v1", "source_url": source,
           "collected_at": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
           "ranking_date": now.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
           "category_code": category, "rows": result["products"]}
print("COSMETICS_RANK_CAPTURE " + json.dumps(capture, ensure_ascii=False), flush=True)
