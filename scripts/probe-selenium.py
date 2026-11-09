"""Collect public ranking and product details with Selenium.

Uses the browser configuration from the supplied reference (headless Chrome,
1920x1080 viewport, Chrome 120 User-Agent) and waits briefly for client-side
rendering before validating the page. It does not solve or interact with
CAPTCHAs or Cloudflare challenges.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from product_taxonomy import product_top_category
from manufacturer_info import enrich_product_details

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

RANKING_TO_DETAILS_DELAY_SECONDS = 10
RANKING_INITIAL_WAIT_SECONDS = 2
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)
BASE = "https://www.oliveyoung.co.kr"
TARGETS = [
    ("overall", BASE + "/store/main/getBestList.do"),
    ("product", BASE + "/store/goods/getGoodsDetail.do?goodsNo=A000001002386"),
]


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def document_response(driver, expected_url):
    """Return the main Olive Young document response status from Chrome logs."""
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
            if (params.get("type") == "Document" and parsed.netloc == expected.netloc
                    and parsed.path == expected.path):
                matches.append({"status": response.get("status"), "url": response.get("url")})
        except (KeyError, TypeError, ValueError):
            continue
    return matches[-1] if matches else None


def page_diagnostic(driver, source, stage, navigation_timed_out=False):
    try:
        body = driver.execute_script("return document.body?.innerText || ''") or ""
    except Exception:
        body = ""
    try:
        final_url = driver.current_url
    except Exception:
        final_url = ""
    try:
        page_title = driver.title
    except Exception:
        page_title = ""
    try:
        user_agent = driver.execute_script("return navigator.userAgent")
    except Exception:
        user_agent = ""
    return {
        "stage": stage,
        "requested_url": source,
        "final_url": final_url,
        "document_response": document_response(driver, source),
        "page_title": page_title,
        "page_excerpt": " ".join(body.split())[:600],
        "browser_version": driver.capabilities.get("browserVersion", ""),
        "effective_user_agent": user_agent,
        "navigation_timed_out": navigation_timed_out,
        "challenge_indicators": {
            marker: marker in (page_title + " " + body).lower()
            for marker in (
                "cloudflare", "just a moment", "checking your browser",
                "verify you are human", "attention required", "challenge",
            )
        },
    }


def extract(driver, kind, source):
    if kind == "overall":
        expected_tab = parse_qs(urlsplit(source).query).get("fltDispCatNo", [""])[0]
        selected = driver.execute_script("""
          return Array.from(document.querySelectorAll('#Container li.on > button[title="선택됨"]'))
            .map(e=>({id:e.getAttribute('data-ref-dispcatno')||'',text:e.textContent.trim()}));
        """)
        category_matches = any(
            item["id"] == expected_tab and (bool(expected_tab) or item["text"] == "전체")
            for item in selected
        )
        actual_page = urlsplit(driver.current_url)
        category_matches = category_matches and actual_page.netloc == "www.oliveyoung.co.kr" and actual_page.path == "/store/main/getBestList.do" and parse_qs(actual_page.query).get("fltDispCatNo", [""])[0] == expected_tab
        rows = driver.execute_script("""
          return Array.from(document.querySelectorAll('#Container .cate_prd_list .prd_info')).map(card=>{
            const href=card.querySelector('.prd_name a')?.getAttribute('href');
            let id='';try{id=new URL(href,document.baseURI).searchParams.get('goodsNo')||'';}catch{}
            return {rank:Number(card.querySelector('.thumb_flag.best')?.textContent.trim()),
              product_id:id,brand_name:card.querySelector('.tx_brand')?.textContent.trim()||'',
              product_name:card.querySelector('.tx_name')?.textContent.trim()||'',
              product_category:card.querySelector('[data-ref-goodscategory]')?.getAttribute('data-ref-goodscategory')||'',
              product_url:id?'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo='+encodeURIComponent(id):''};
          });
        """)
        for row in rows:
            row["product_category"] = product_top_category(row["product_category"])
        valid = (
            category_matches and len(rows) == 100
            and sorted(r["rank"] for r in rows) == list(range(1, 101))
            and len({r["product_id"] for r in rows}) == 100
            and all(r["product_id"] and r["brand_name"] and r["product_name"] for r in rows)
        )
        return {"valid": valid, "product_count": len(rows), "products": rows, "category_matches": category_matches}

    def first_text(candidates):
        for by, selector in candidates:
            for element in driver.find_elements(by, selector):
                if element.is_displayed() and element.text.strip():
                    return element.text.strip()
        return ""

    # The first XPath is copied from the user's reference code.
    name = first_text([
        (By.CSS_SELECTOR, 'h3[class*="GoodsDetailInfo_title__"]'),
        (By.XPATH, '//*[@id="Contents"]/div[2]/div[2]/div/p[2]'),
        (By.CSS_SELECTOR, "#Contents .prd_detail_box .prd_name"),
    ])
    brand = first_text([
        (By.CSS_SELECTOR, '[class*="GoodsDetailInfo_goods-info"] button[class*="TopUtils_btn-brand__"]'),
        (By.CSS_SELECTOR, "#Contents .prd_detail_box .prd_brand .link_brand"),
        (By.CSS_SELECTOR, "#Contents .prd_detail_box .prd_brand"),
    ])
    actual = urlsplit(driver.current_url)
    expected_id = parse_qs(urlsplit(source).query)["goodsNo"][0]
    valid = bool(
        name and brand and actual.netloc == "www.oliveyoung.co.kr"
        and actual.path == "/store/goods/getGoodsDetail.do"
        and parse_qs(actual.query).get("goodsNo") == [expected_id]
    )
    rows = [{"product_id": expected_id, "brand_name": brand,
             "product_name": name, "product_url": source}] if valid else []
    return {"valid": valid, "product_count": len(rows), "products": rows}


def probe(kind, source, chrome_binary, category_code=None, category_name=None):
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1920,1080")
    options.add_argument(f"user-agent={USER_AGENT}")
    options.page_load_strategy = "eager"
    options.set_capability("goog:loggingPrefs", {"performance": "ALL"})
    if chrome_binary:
        options.binary_location = chrome_binary
    driver = None
    started = time.monotonic()
    stage = "browser_start"
    navigation_timed_out = False
    try:
        driver = webdriver.Chrome(options=options)
        # Unlike the reference, apply timeout BEFORE get().
        driver.set_page_load_timeout(30)
        stage = "ranking_navigation"
        emit({"stage": "category_list_request_started", "request_type": "category_ranking_list",
              "category_code": category_code, "category_name": category_name,
              "requested_url": source})
        try:
            driver.get(source)
        except TimeoutException:
            navigation_timed_out = True
            emit({"target": kind, "stage": "page_load_timeout"})
        stage = "ranking_page_wait"
        time.sleep(RANKING_INITIAL_WAIT_SECONDS)
        stage = "initial_rank_extraction"
        initial = extract(driver, kind, source)
        emit({"target": kind, "stage": "after_reference_2s_wait",
              "title": driver.title, "current_url": driver.current_url,
              "product_count": initial["product_count"],
              "category_matches": initial.get("category_matches")})
        if not initial["valid"]:
            stage = "category_validation_wait"
            try:
                WebDriverWait(driver, 20, poll_frequency=2).until(
                    lambda d: extract(d, kind, source)["valid"]
                )
            except TimeoutException:
                pass
        stage = "final_rank_validation"
        result = extract(driver, kind, source)
        diagnostic = page_diagnostic(driver, source, stage, navigation_timed_out)
        emit({"stage": "category_list_result", "request_type": "category_ranking_list",
              "category_code": category_code, "category_name": category_name,
              "valid": result["valid"], "product_count": result["product_count"],
              "category_matches": result.get("category_matches"),
              "requested_url": source, "final_url": diagnostic["final_url"],
              "document_response": diagnostic["document_response"],
              "page_title": diagnostic["page_title"],
              "navigation_timed_out": navigation_timed_out})
        if not result["valid"]:
            result.update(diagnostic)
        if kind == "overall" and result["valid"]:
            stage = "product_detail_enrichment"
            time.sleep(RANKING_TO_DETAILS_DELAY_SECONDS)
            enrich_product_details(driver, result["products"], category_code=category_code)
        if kind == "product" and not result["valid"]:
            result["selector_diagnostics"] = driver.execute_script("""
              const expected=document.title.replace(/\\s*\\|\\s*올리브영.*$/,'').trim();
              return Array.from(document.querySelectorAll('p,h1,h2,h3,span,div,a'))
                .filter(e=>e.children.length===0 && (e.textContent.trim()==='에스트라' || (expected.length>10 && e.textContent.trim()===expected)))
                .slice(0,10).map(e=>({tag:e.tagName,id:e.id,classes:e.className,text:e.textContent.trim(),
                  ancestors:(()=>{const a=[];let p=e.parentElement;for(let n=0;p&&n<5;n++,p=p.parentElement)a.push({tag:p.tagName,id:p.id,classes:p.className});return a;})()}));
            """)
        return {"target": kind, "source_url": source, "final_url": driver.current_url,
                "title": driver.title, "elapsed_seconds": round(time.monotonic()-started, 1),
                "category_code": category_code, "category_name": category_name,
                "browser_version": driver.capabilities.get("browserVersion"),
                "effective_user_agent": driver.execute_script("return navigator.userAgent"),
                **result}
    except Exception as error:
        details = page_diagnostic(driver, source, stage, navigation_timed_out) if driver is not None else {}
        return {"target": kind, "source_url": source, "valid": False,
                "product_count": 0, "error_type": type(error).__name__,
                "error": str(error)[:1200], **details}
    finally:
        if driver is not None:
            driver.quit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--chrome-binary")
    parser.add_argument("--output", default="data/selenium-reference-probe.json")
    parser.add_argument("--target", choices=["overall", "product", "both"], default="both")
    args = parser.parse_args()
    results = []
    for kind, source in TARGETS:
        if args.target != "both" and args.target != kind:
            continue
        emit({"stage": "starting", "target": kind, "source_url": source})
        result = probe(kind, source, args.chrome_binary,
                       category_code="overall" if kind == "overall" else None,
                       category_name="전체랭킹" if kind == "overall" else None)
        results.append(result)
        emit({"stage": "result", **{k:v for k,v in result.items() if k != "products"},
              "sample_products": result.get("products", [])[:3]})
    report = {"tested_at": datetime.now(timezone.utc).isoformat(),
              "configuration": "headless/no-sandbox/1920x1080/Chrome120 User-Agent/2s initial wait",
              "db_writes": False, "prices_extracted": False, "images_extracted": False,
              "results": results}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    emit({"report": str(output), "successful_targets": sum(bool(r["valid"]) for r in results)})
    return 0 if all(r["valid"] for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
