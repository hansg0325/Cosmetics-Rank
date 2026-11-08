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
        os.environ["OLIVERANK_KEYWORD_RULES"] = rules_input

spec = importlib.util.spec_from_file_location("selenium_probe", Path(__file__).with_name("probe-selenium.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
categories = json.loads((Path(__file__).resolve().parent.parent / "src/shared/collectionCategories.json").read_text(encoding="utf-8"))
parser = argparse.ArgumentParser()
parser.add_argument("--category", choices=list(categories), default="overall")
category = parser.parse_args().category
source = categories[category]["source_url"]
result = module.probe("overall", source, os.environ.get("OLIVERANK_CHROME_BINARY"))
if not result.get("valid"):
    print("OLIVERANK_ERROR " + json.dumps({"message": categories[category]["name"] + " 랭킹 100개 또는 선택된 카테고리를 확인하지 못했습니다. 접속 확인 또는 사이트 상태를 확인한 뒤 다시 시도하세요.", "page_title": result.get("title", ""), "product_count": result.get("product_count", 0)}, ensure_ascii=False), flush=True)
    sys.exit(2)
now = datetime.now(timezone.utc)
capture = {"format": "oliverank-browser-v1", "source_url": source,
           "collected_at": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
           "ranking_date": now.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
           "category_code": category, "rows": result["products"]}
print("OLIVERANK_CAPTURE " + json.dumps(capture, ensure_ascii=False), flush=True)
