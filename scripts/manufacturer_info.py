"""Read manufacturer, ingredients and aggregate review data in one page visit."""
import json
import os
import time
from pathlib import Path
from urllib.parse import urlsplit, parse_qs
from ingredient_keywords import ingredient_keywords

ROOT = Path(__file__).resolve().parent.parent
DETAIL_INTERVAL_SECONDS = 3
DETAIL_TIME_BUDGET_SECONDS = 3600
DETAIL_CACHE_TTL_SECONDS = 3600


def document_response(driver, expected_url):
    """Return the main document status for a detail URL from Chrome performance logs."""
    expected = urlsplit(expected_url)
    matches = []
    try:
        entries = driver.get_log("performance")
    except Exception:
        return None
    for entry in entries:
        try:
            message = json.loads(entry["message"])["message"]
            if message.get("method") != "Network.responseReceived":
                continue
            params = message.get("params", {})
            response = params.get("response", {})
            parsed = urlsplit(response.get("url", ""))
            if params.get("type") == "Document" and parsed.netloc == expected.netloc and parsed.path == expected.path:
                matches.append({"status": response.get("status"), "url": response.get("url")})
        except (KeyError, TypeError, ValueError):
            continue
    return matches[-1] if matches else None


def split_manufacturer_seller(text):
    if not isinstance(text, str) or "/" not in text:
        return None, None
    manufacturer, seller = text.split("/", 1)
    return manufacturer.strip() or None, seller.strip() or None


def enrich_product_details(driver, rows, category_code=None):
    """One native page visit per uncached product; extract all fields from its DOM."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    state_dir = Path(os.environ.get("COSMETICS_RANK_DETAIL_STATE_DIR", ROOT / ".local-browser"))
    path = state_dir / "product-detail-cache.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        cache = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        cache = {}
    cache = {key: value for key, value in cache.items() if isinstance(value, dict) and value.get("version") == 1 and 0 <= time.time() - value.get("checked_at", 0) < DETAIL_CACHE_TTL_SECONDS}
    script = (ROOT / "scripts/product_details.js").read_text(encoding="utf-8")
    cooldown = path.parent / "product-detail-cooldown.json"
    blocked = False
    try:
        blocked = time.time() < json.loads(cooldown.read_text(encoding="utf-8")).get("until", 0)
    except (OSError, ValueError):
        pass
    diagnostics = []
    consecutive_errors = 0
    started = time.monotonic()
    last_visit_finished = None
    for index, row in enumerate(rows):
        product_id = row["product_id"]
        cached = cache.get(product_id)
        requested = False
        detail_page_title = ""
        detail_error_type = None
        detail_error = None
        detail_response = None
        detail_final_url = None
        detail_page_excerpt = None
        status = "CACHE" if cached else "SKIPPED_ACCESS_LIMIT" if blocked else "SKIPPED_ERRORS"
        if time.monotonic() - started > DETAIL_TIME_BUDGET_SECONDS and not cached:
            status = "SKIPPED_TIME_BUDGET"
        if not cached and not blocked and consecutive_errors < 3 and time.monotonic() - started <= DETAIL_TIME_BUDGET_SECONDS:
            if last_visit_finished is not None:
                remaining = DETAIL_INTERVAL_SECONDS - (time.monotonic() - last_visit_finished)
                if remaining > 0:
                    time.sleep(remaining)
            result = None
            try:
                requested = True
                print(json.dumps({"stage": "product_detail_request_started",
                    "request_type": "product_detail",
                    "category_code": category_code, "index": index + 1, "total": len(rows),
                    "product_id": product_id, "url": row["product_url"]}), flush=True)
                driver.get(row["product_url"])
                detail_response = document_response(driver, row["product_url"])
                detail_final_url = driver.current_url
                detail_page_title = driver.title
                actual = urlsplit(driver.current_url)
                if actual.netloc != "www.oliveyoung.co.kr" or actual.path != "/store/goods/getGoodsDetail.do" or parse_qs(actual.query).get("goodsNo") != [product_id]:
                    raise ValueError("상품 출처 불일치")
                def read(d):
                    return d.execute_script(script, product_id, row["product_name"])
                # Wait for the main product header and its asynchronously rendered summary.
                result = WebDriverWait(driver, 12).until(read)
                # Opening the disclosure never reloads the product page.
                buttons = driver.find_elements(By.XPATH, "//button[normalize-space(.)='상품정보 제공고시']") or driver.find_elements(By.CSS_SELECTOR, "#detailInfo a")
                if buttons:
                    button = buttons[0]
                    try:
                        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
                        if button.get_attribute("aria-expanded") != "true":
                            button.click()
                        expanded = WebDriverWait(driver, 8).until(lambda d: (value if (value := read(d)) and value["disclosure_checked"] else False))
                        # A disclosure rendering failure must not discard the review summary.
                        if result["review_status"] == "FOUND" and expanded["review_status"] != "FOUND":
                            expanded.update({key: result[key] for key in ("review_count", "rating", "review_status")})
                        result = expanded
                    except Exception as error:
                        diagnostics.append({"product_id": product_id, "disclosure_error": type(error).__name__})
                cached = {**result, "version": 1, "checked_at": time.time()}
                cache[product_id] = cached
                status = "READ"
                consecutive_errors = 0
            except Exception as error:
                consecutive_errors += 1
                detail_error_type = type(error).__name__
                detail_error = str(error)[:500]
                try:
                    detail_page_title = driver.title
                    detail_final_url = driver.current_url
                    body = driver.execute_script("return document.body?.innerText?.slice(0,600) || ''")
                    detail_response = document_response(driver, row["product_url"])
                except Exception:
                    body = ""
                detail_page_excerpt = " ".join(body.split())[:600] or None
                title = detail_page_title.lower()
                body = body.lower()
                blocked = any(word in title for word in ("moment", "기다", "접속", "too many", "429", "access denied")) or any(word in body for word in ("서비스 이용이 제한", "비정상적인 접근", "접근이 차단", "too many requests", "access denied", "just a moment", "captcha"))
                status = "ACCESS_LIMIT" if blocked else type(error).__name__
                if blocked:
                    cooldown.write_text(json.dumps({"until": time.time() + 60}), encoding="utf-8")
            last_visit_finished = time.monotonic()
        raw = cached.get("raw") if cached else None
        manufacturer, seller = split_manufacturer_seller(raw)
        row["manufacturer_disclosure"] = raw
        row["manufacturer_name"] = manufacturer
        row["seller_name"] = seller
        row["keywords"] = ingredient_keywords(cached.get("ingredients") if cached else None)
        row["review_count"] = cached.get("review_count") if cached else None
        row["rating"] = cached.get("rating") if cached else None
        diagnostics.append({"product_id": product_id, "status": status,
            "manufacturer": manufacturer is not None, "seller": seller is not None,
            "ingredients": row["keywords"] is not None,
            "review_status": cached.get("review_status") if cached else "NOT_COLLECTED",
            "review_count": row["review_count"], "rating": row["rating"]})
        progress = {"stage": "product_details", "done": index + 1, "total": len(rows),
            "category_code": category_code,
            "product_id": product_id,
            "product_url": row["product_url"],
            "request_action": "REQUESTED" if requested else "CACHE_HIT" if cached else status,
            "status": status,
            "page_title": detail_page_title or None,
            "page_excerpt": detail_page_excerpt,
            "detail_final_url": detail_final_url,
            "document_response": detail_response,
            "error_type": detail_error_type,
            "error": detail_error,
            "manufacturer_found": row.get("manufacturer_name") is not None,
            "seller_found": row.get("seller_name") is not None,
            "ingredients_found": row.get("keywords") is not None,
            "review_status": cached.get("review_status") if cached else "NOT_COLLECTED",
            "review_count_found": row.get("review_count") is not None,
            "rating_found": row.get("rating") is not None,
            "manufacturer": sum(item.get("manufacturer_name") is not None for item in rows[:index + 1]),
            "ingredients": sum(item.get("keywords") is not None for item in rows[:index + 1]),
            "reviews": sum(item.get("review_count") is not None for item in rows[:index + 1]),
            "ratings": sum(item.get("rating") is not None for item in rows[:index + 1])}
        print(json.dumps(progress), flush=True)
        (path.parent / "product-detail-progress.json").write_text(json.dumps(progress), encoding="utf-8")
        (path.parent / "product-detail-diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False), encoding="utf-8")
        path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
    return {
        "total": len(rows),
        "succeeded": sum(item.get("status") in {"READ", "CACHE"} for item in diagnostics),
        "access_limited": sum(item.get("status") == "ACCESS_LIMIT" for item in diagnostics),
    }


# Compatibility for local diagnostic scripts; collection uses the unified name.
enrich_manufacturers = enrich_product_details
