"""Diagnostic only: two public pages, no DB writes, prices, images or reviews.

Reproduces the supplied crawler's --headless, --no-sandbox, old User-Agent
and 10-second wait. Uses Selenium Manager for driver provisioning instead
of webdriver_manager. No CAPTCHA interaction or retries are performed.
"""

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

from selenium import webdriver
from selenium.common.exceptions import TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/58.0.3029.110 Safari/537.3"
)
BASE = "https://www.oliveyoung.co.kr"
TARGETS = [
    ("overall", BASE + "/store/main/getBestList.do"),
    ("product", BASE + "/store/goods/getGoodsDetail.do?goodsNo=A000001002386"),
]


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def extract(driver, kind, source):
    if kind == "overall":
        rows = driver.execute_script("""
          return Array.from(document.querySelectorAll('#Container .cate_prd_list .prd_info')).map(card=>{
            const href=card.querySelector('.prd_name a')?.getAttribute('href');
            let id='';try{id=new URL(href,document.baseURI).searchParams.get('goodsNo')||'';}catch{}
            return {rank:Number(card.querySelector('.thumb_flag.best')?.textContent.trim()),
              product_id:id,brand_name:card.querySelector('.tx_brand')?.textContent.trim()||'',
              product_name:card.querySelector('.tx_name')?.textContent.trim()||'',
              product_category:(card.querySelector('[data-ref-goodscategory]')?.getAttribute('data-ref-goodscategory')||'').split('>').map(s=>s.trim()).filter(Boolean).filter(s=>!/^\\d+$/.test(s))[0]||'',
              product_url:id?'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo='+encodeURIComponent(id):''};
          });
        """)
        valid = (
            len(rows) == 100
            and sorted(r["rank"] for r in rows) == list(range(1, 101))
            and len({r["product_id"] for r in rows}) == 100
            and all(r["product_id"] and r["brand_name"] and r["product_name"] for r in rows)
        )
        return {"valid": valid, "product_count": len(rows), "products": rows}

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


def probe(kind, source, chrome_binary):
    options = webdriver.ChromeOptions()
    options.add_argument("--headless")
    options.add_argument("--no-sandbox")
    options.add_argument(f"user-agent={USER_AGENT}")
    if chrome_binary:
        options.binary_location = chrome_binary
    driver = None
    started = time.monotonic()
    try:
        driver = webdriver.Chrome(options=options)
        # Unlike the reference, apply timeout BEFORE get().
        driver.set_page_load_timeout(30)
        try:
            driver.get(source)
        except TimeoutException:
            emit({"target": kind, "stage": "page_load_timeout"})
        time.sleep(10)
        initial = extract(driver, kind, source)
        emit({"target": kind, "stage": "after_reference_10s_wait",
              "title": driver.title, "product_count": initial["product_count"]})
        if not initial["valid"]:
            try:
                WebDriverWait(driver, 20, poll_frequency=2).until(
                    lambda d: extract(d, kind, source)["valid"]
                )
            except TimeoutException:
                pass
        result = extract(driver, kind, source)
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
                "browser_version": driver.capabilities.get("browserVersion"),
                "effective_user_agent": driver.execute_script("return navigator.userAgent"),
                **result}
    except Exception as error:
        return {"target": kind, "source_url": source, "valid": False,
                "product_count": 0, "error_type": type(error).__name__,
                "error": str(error)[:1200]}
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
        result = probe(kind, source, args.chrome_binary)
        results.append(result)
        emit({"stage": "result", **{k:v for k,v in result.items() if k != "products"},
              "sample_products": result.get("products", [])[:3]})
    report = {"tested_at": datetime.now(timezone.utc).isoformat(),
              "configuration": "reference headless/no-sandbox/Chrome58 User-Agent",
              "db_writes": False, "prices_extracted": False, "images_extracted": False,
              "results": results}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    emit({"report": str(output), "successful_targets": sum(bool(r["valid"]) for r in results)})
    return 0 if all(r["valid"] for r in results) else 2


if __name__ == "__main__":
    sys.exit(main())
