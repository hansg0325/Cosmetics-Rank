"""One isolated Selenium run; stdout marker is consumed by local collector."""
import importlib.util
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

spec = importlib.util.spec_from_file_location("selenium_probe", Path(__file__).with_name("probe-selenium.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
result = module.probe("overall", module.TARGETS[0][1], os.environ.get("OLIVERANK_CHROME_BINARY"))
if not result.get("valid"):
    print("OLIVERANK_ERROR " + json.dumps({"message": "전체 랭킹 100개를 읽지 못했습니다. 접속 확인 또는 사이트 상태를 확인한 뒤 다시 시도하세요.", "page_title": result.get("title", ""), "product_count": result.get("product_count", 0)}, ensure_ascii=False), flush=True)
    sys.exit(2)
now = datetime.now(timezone.utc)
capture = {"format": "oliverank-browser-v1", "source_url": module.TARGETS[0][1],
           "collected_at": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"),
           "ranking_date": now.astimezone(timezone(timedelta(hours=9))).date().isoformat(),
           "category_code": "overall", "rows": result["products"]}
print("OLIVERANK_CAPTURE " + json.dumps(capture, ensure_ascii=False), flush=True)
