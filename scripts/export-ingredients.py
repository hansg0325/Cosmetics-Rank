"""Export ingredient disclosures for the latest saved overall TOP 100 to TXT.

Reads local ranking APIs; visits each product sequentially. No DB writes,
price/image extraction, CAPTCHA interaction or automatic network retries.
"""
import argparse
from collections import Counter
import importlib.util
import json
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.request import Request, urlopen

from selenium import webdriver
from selenium.common.exceptions import ElementClickInterceptedException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parent.parent
KST = timezone(timedelta(hours=9))


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def saved_ranking():
    token = next(line.split("=", 1)[1].strip() for line in (ROOT / ".dev.vars").read_text().splitlines() if line.startswith("LOCAL_DEV_TOKEN="))
    def get(path):
        with urlopen(Request("http://127.0.0.1:8787/api/" + path, headers={"x-local-token": token}), timeout=10) as response:
            return json.load(response)
    candidates = [r for r in get("imports") if r["category_code"] == "overall" and r["is_active"] and r["status"] == "COMPLETE"]
    snapshot = max(candidates, key=lambda r: (r["ranking_date"], r["snapshot_id"]))
    rows = get("rankings?date=" + snapshot["ranking_date"] + "&category=overall")
    if len(rows) != 100 or {r["rank"] for r in rows} != set(range(1, 101)) or len({r["product_id"] for r in rows}) != 100:
        raise RuntimeError("최신 전체 랭킹 100개 검증 실패")
    return snapshot, sorted(rows, key=lambda r: r["rank"])


def extract(driver, product):
    source = "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=" + product["product_id"]
    result = {"rank": product["rank"], "product_id": product["product_id"], "brand_name": product["brand_name_at_capture"], "product_name": product["product_name_at_capture"], "source_url": source, "checked_at": now(), "status": "FAILED", "fields": []}
    try:
        driver.get(source)
        WebDriverWait(driver, 18, poll_frequency=1).until(lambda d: d.find_elements(By.XPATH, "//button[normalize-space(.)='상품정보 제공고시']") or d.find_elements(By.CSS_SELECTOR, "#detailInfo"))
        buttons = driver.find_elements(By.XPATH, "//button[normalize-space(.)='상품정보 제공고시']")
        if not buttons:
            buttons = driver.find_elements(By.CSS_SELECTOR, "#detailInfo a")
        if buttons:
            button = buttons[0]
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
            if button.get_attribute("aria-expanded") != "true":
                try:
                    button.click()
                except ElementClickInterceptedException:
                    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", button)
                    time.sleep(0.6)
                    button.click()
        def read_fields(d):
            return d.execute_script("""
              const candidates=Array.from(document.querySelectorAll('tr')).map(row=>{
                const cells=Array.from(row.querySelectorAll(':scope > th,:scope > td'));
                if(cells.length<2)return null;
                return {label:cells[0].innerText.trim(),text:cells.slice(1).map(c=>c.innerText.trim()).join('\\n').trim()};
              }).filter(Boolean);
              return candidates.filter(r=>/전성분|모든\\s*성분|원재료|원료명|주요\\s*성분|사용된\\s*화학물질|주요\\s*물질|성분\\s*(및|과)?\\s*함량/.test(r.label));
            """)
        # Wait for the disclosure table to expand, not for image content.
        try:
            fields = WebDriverWait(driver, 6, poll_frequency=0.5).until(read_fields)
        except TimeoutException:
            fields = []
        result["fields"] = fields
        if not fields:
            result.update(status="NO_INGREDIENT_FIELD", reason="고시표에서 전성분·원재료·주요성분 항목을 찾지 못함")
        elif all(not f["text"] or re.fullmatch(r"[\s\W]*(상세\s*(페이지|설명|정보)|제품\s*상세|이미지|별도\s*표시)[\s\S]{0,30}(참조|참고|확인)[\s\W]*", f["text"]) for f in fields):
            result.update(status="REFERENCE_ONLY", reason="성분 값이 비어 있거나 상세 페이지/이미지 참조로만 표시됨")
        else:
            result["status"] = "FOUND"
    except Exception as error:
        title = driver.title
        result["reason"] = "접속 확인 화면에서 완료되지 않음" if "기다" in title or "moment" in title.lower() else type(error).__name__ + ": 상품정보 고시표 확인 실패"
        result["page_title"] = title
    result["checked_at"] = now()
    return result


def write_outputs(path, snapshot, products, results):
    found = sum(r["status"] == "FOUND" for r in results)
    counts = Counter(r['status'] for r in results)
    labels = {"FOUND": "성분 원문 확인", "REFERENCE_ONLY": "상세정보 참조/내용 미제공", "NO_INGREDIENT_FIELD": "성분 항목 없음", "FAILED": "확인 실패", "NOT_ATTEMPTED": "접속 제한으로 후속 확인 중단"}
    lines = ["cosmetics rank 전체 랭킹 상품 성분 목록", "", f'랭킹 기준 날짜(KST): {snapshot["ranking_date"]}', f'랭킹 스냅샷 ID: {snapshot["snapshot_id"]}', f'파일 생성 시각(KST): {datetime.now(KST).isoformat(timespec="seconds")}', f"대상 상품: {len(products)}개 / 현재 확인: {len(results)}개 / 성분 원문 확인: {found}개", "", "이 파일은 상품정보 제공고시의 성분/원재료 항목을 원문으로 옮긴 자료입니다.", "기획/옵션 상품은 여러 구성품의 성분이 함께 표기될 수 있습니다. 성분 표기를 임의로 합치거나 추정하지 않았습니다.", "상세 이미지에만 있는 정보는 OCR 처리하지 않았습니다. 가격과 이미지는 수집하지 않았습니다.", ""]
    lines[8:8] = [f"결과: 원문 확인 {found}개 / 상세정보 참조 {counts['REFERENCE_ONLY']}개 / 성분 항목 없음 {counts['NO_INGREDIENT_FIELD']}개 / 확인 실패 {counts['FAILED']}개 / 접속 중단 {counts['NOT_ATTEMPTED']}개", "", "성분란에 일부 성분만 적힌 경우도 사이트 원문 그대로 옮겼습니다. 누락된 성분을 추정하거나 전성분의 완전성을 보증하지 않습니다."]
    for row in results:
        lines.extend(["=" * 88, f'{row["rank"]:03d}위 | {row["brand_name"]} | {row["product_name"]}', f'상품 ID: {row["product_id"]}', f'출처: {row["source_url"]}', f'확인 시각(UTC): {row["checked_at"]}', f'상태: {labels[row["status"]]}'])
        if row.get("reason"):
            lines.append("비고: " + row["reason"])
        for field in row["fields"]:
            lines.extend(["", "[" + field["label"] + "]", field["text"] or "(내용 없음)"])
        lines.append("")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8-sig")
    path.with_suffix(".json").write_text(json.dumps({"snapshot": snapshot, "products": products, "results": results}, ensure_ascii=False, indent=2), encoding="utf-8")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--retry-unavailable", action="store_true")
    parser.add_argument("--output")
    args = parser.parse_args()
    snapshot, products = saved_ranking()
    path = Path(args.output) if args.output else ROOT / "data/exports" / f'cosmetics-rank_전체랭킹_전성분_{snapshot["ranking_date"]}.txt'
    results = []
    if (args.resume or args.retry_unavailable) and path.with_suffix(".json").exists():
        previous = json.loads(path.with_suffix(".json").read_text(encoding="utf-8"))
        if previous["snapshot"]["snapshot_id"] != snapshot["snapshot_id"]:
            raise RuntimeError("저장된 진행 기록과 현재 랭킹 스냅샷이 다릅니다")
        results = previous["results"]
    spec = importlib.util.spec_from_file_location("probe", ROOT / "scripts/probe-selenium.py")
    probe = importlib.util.module_from_spec(spec); spec.loader.exec_module(probe)
    options = webdriver.ChromeOptions()
    options.binary_location = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
    options.add_argument("--headless"); options.add_argument("--no-sandbox")
    options.add_argument("--window-size=1280,1200"); options.add_argument("user-agent=" + probe.USER_AGENT)
    driver = webdriver.Chrome(options=options)
    driver.set_page_load_timeout(25)
    blocked = 0
    try:
        indices = [i for i, r in enumerate(results) if r['status'] in ('FAILED', 'NO_INGREDIENT_FIELD') and r.get('reason') != '접속 확인 화면에서 완료되지 않음'] if args.retry_unavailable else list(range(len(results),len(products)))
        for index in indices:
            product = products[index]
            if blocked >= 3:
                result = {"rank": product["rank"], "product_id": product["product_id"], "brand_name": product["brand_name_at_capture"], "product_name": product["product_name_at_capture"], "source_url": "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=" + product["product_id"], "checked_at": now(), "status": "NOT_ATTEMPTED", "reason": "접속 확인이 3회 연속 완료되지 않아 추가 접속을 중단함", "fields": []}
            else:
                result = extract(driver, product)
                blocked = blocked + 1 if result.get("reason") == "접속 확인 화면에서 완료되지 않음" else 0
            if args.retry_unavailable:
                results[index] = result
            else:
                results.append(result)
            write_outputs(path, snapshot, products, results)
            print(json.dumps({"done": len(results), "total": len(products), "rank": result["rank"], "status": result["status"], "ingredient_characters": sum(len(f["text"]) for f in result["fields"]), "found": sum(r["status"] == "FOUND" for r in results)}, ensure_ascii=False), flush=True)
            if blocked < 3:
                time.sleep(2)
    finally:
        driver.quit()
    print(json.dumps({"output": str(path), "total": len(results), "found": sum(r["status"] == "FOUND" for r in results)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
