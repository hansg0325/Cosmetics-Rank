import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
import manufacturer_info as details

class Timeout(Exception):
    pass

class Wait:
    def __init__(self, driver, *args):
        self.driver = driver
    def until(self, fn):
        result = fn(self.driver)
        if not result:
            raise Timeout()
        return result

class Button:
    def __init__(self, driver):
        self.driver = driver
    def get_attribute(self, name):
        return "false"
    def click(self):
        if self.driver.fail_disclosure:
            raise RuntimeError("disclosure unavailable")
        self.driver.expanded = True

class Driver:
    title = "상품 | 올리브영"
    def __init__(self, fail_disclosure=False, blocked=False):
        self.visits = []
        self.expanded = False
        self.fail_disclosure = fail_disclosure
        self.blocked = blocked
    def get(self, url):
        self.visits.append(url)
        self.current_url = url
        if self.blocked:
            self.title = "Just a moment"
            raise Timeout()
    def find_elements(self, *args):
        return [Button(self)]
    def execute_script(self, script, *args):
        if script.startswith("// Read only"):
            return {"product_id":args[0], "raw":"제조업자/판매업자" if self.expanded else None,
                "ingredients":"세라마이드, 나이아신아마이드" if self.expanded else None,
                "disclosure_checked":self.expanded, "review_count":1234, "rating":4.8, "review_status":"FOUND"}
        return ""  # scroll / challenge text; no network primitive exists

def row(product_id="A000001002386"):
    return {"product_id":product_id,"product_name":"상품", "product_url":f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={product_id}"}

class DetailTests(unittest.TestCase):
    def run_enrichment(self, driver, rows, root):
        modules = {
            "selenium.webdriver.common.by": SimpleNamespace(By=SimpleNamespace(XPATH="xpath",CSS_SELECTOR="css selector")),
            "selenium.webdriver.support.ui": SimpleNamespace(WebDriverWait=Wait),
            "selenium.common.exceptions": SimpleNamespace(TimeoutException=Timeout,ElementClickInterceptedException=type("ClickIntercepted",(Exception,),{})),
        }
        with patch.dict(sys.modules, modules), patch.object(details,"ROOT",root), patch.object(details.time,"sleep") as sleeper:
            details.enrich_product_details(driver,rows)
            return [call.args[0] for call in sleeper.call_args_list]
    def make_root(self, folder):
        root = Path(folder)
        (root/"scripts").mkdir()
        (root/"scripts/product_details.js").write_text("// Read only",encoding="utf-8")
        return root
    def test_one_visit_reads_all_fields_and_shared_cache_reuses_product(self):
        with tempfile.TemporaryDirectory() as folder:
            root=self.make_root(folder); driver=Driver(); rows=[row(),row()]
            self.run_enrichment(driver,rows,root)
            self.assertEqual(len(driver.visits),1)
            for item in rows:
                self.assertEqual((item["manufacturer_name"],item["seller_name"],item["review_count"],item["rating"]),("제조업자","판매업자",1234,4.8))
                self.assertEqual(item["keywords"],["세라마이드","나이아신아마이드"])
    def test_disclosure_failure_preserves_reviews(self):
        with tempfile.TemporaryDirectory() as folder:
            root=self.make_root(folder); driver=Driver(fail_disclosure=True); rows=[row()]
            self.run_enrichment(driver,rows,root)
            self.assertEqual(len(driver.visits),1)
            self.assertEqual(rows[0]["review_count"],1234)
            self.assertEqual(rows[0]["rating"],4.8)
            self.assertIsNone(rows[0]["manufacturer_name"])
            self.assertIsNone(rows[0]["keywords"])
    def test_two_second_gap_between_distinct_detail_visits(self):
        with tempfile.TemporaryDirectory() as folder:
            root=self.make_root(folder); driver=Driver()
            delays=self.run_enrichment(driver,[row(),row("A000000000001")],root)
            self.assertEqual(len(driver.visits),2)
            self.assertEqual(len(delays),1)
            self.assertGreater(delays[0],1.9)
            self.assertLessEqual(delays[0],2)
    def test_blocked_page_stops_later_visits_and_records_missing_values(self):
        with tempfile.TemporaryDirectory() as folder:
            root=self.make_root(folder); driver=Driver(blocked=True); rows=[row(),row("A000000000001")]
            self.run_enrichment(driver,rows,root)
            self.assertEqual(len(driver.visits),1)
            self.assertTrue(all(item["review_count"] is None for item in rows))
            diagnostics=json.loads((root/".local-browser/product-detail-diagnostics.json").read_text(encoding="utf-8"))
            self.assertEqual([r["status"] for r in diagnostics],["ACCESS_LIMIT","SKIPPED_ACCESS_LIMIT"])

if __name__ == "__main__":
    unittest.main()
