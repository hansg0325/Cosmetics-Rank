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


def split_manufacturer_seller(text):
    if not isinstance(text, str) or "/" not in text:
        return None, None
    manufacturer, seller = text.split("/", 1)
    return manufacturer.strip() or None, seller.strip() or None


def enrich_product_details(driver, rows):
    """One native page visit per uncached product; extract all fields from its DOM."""
    from selenium.webdriver.common.by import By
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.common.exceptions import TimeoutException, ElementClickInterceptedException
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
                driver.get(row["product_url"])
                actual = urlsplit(driver.current_url)
                if actual.netloc != "www.oliveyoung.co.kr" or actual.path != "/store/goods/getGoodsDetail.do" or parse_qs(actual.query).get("goodsNo") != [product_id]:
                    raise ValueError("상품 출처 불일치")
                def read(d):
                    return d.execute_script(script, product_id, row["product_name"])
                # Wait for the main product header and its asynchronously rendered summary.
                result = WebDriverWait(driver, 12).until(read)
                if result["review_status"] == "NOT_RENDERED":
                    try:
                        result = WebDriverWait(driver, 6).until(lambda d: (value if (value := read(d)) and value["review_status"] != "NOT_RENDERED" else False))
                    except TimeoutException:
                        pass
                # Opening the disclosure never reloads the product page.
                buttons = driver.find_elements(By.XPATH, "//button[normalize-space(.)='상품정보 제공고시']") or driver.find_elements(By.CSS_SELECTOR, "#detailInfo a")
                if buttons:
                    button = buttons[0]
                    try:
                        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
                        if button.get_attribute("aria-expanded") != "true":
                            try:
                                button.click()
                            except ElementClickInterceptedException:
                                driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
                                time.sleep(0.6)
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
                title = driver.title.lower()
                body = driver.execute_script("return document.body?.innerText?.slice(0,1000) || ''").lower()
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
            "manufacturer": sum(item.get("manufacturer_name") is not None for item in rows[:index + 1]),
            "ingredients": sum(item.get("keywords") is not None for item in rows[:index + 1]),
            "reviews": sum(item.get("review_count") is not None for item in rows[:index + 1]),
            "ratings": sum(item.get("rating") is not None for item in rows[:index + 1])}
        print(json.dumps(progress), flush=True)
        (path.parent / "product-detail-progress.json").write_text(json.dumps(progress), encoding="utf-8")
        (path.parent / "product-detail-diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False), encoding="utf-8")
        path.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


# Compatibility for local diagnostic scripts; collection uses the unified name.
enrich_manufacturers = enrich_product_details
