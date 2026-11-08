import json
import sys
import threading
import time
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from collector_service import Jobs, handler_for, validate_capture, ThreadingHTTPServer, CATEGORIES


def fixture():
    return {"format": "cosmetics-rank-browser-v1", "source_url": "https://www.oliveyoung.co.kr/store/main/getBestList.do", "collected_at": "2026-11-04T00:00:00.000Z", "ranking_date": "2026-11-04", "category_code": "overall", "rows": [
        {"rank": n, "product_id": f"A{n:012d}", "brand_name": "테스트", "product_name": f"상품 {n}", "product_url": f"https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A{n:012d}"} for n in range(1, 101)]}


def completed(jobs, job_id):
    deadline = time.monotonic() + 3
    while time.monotonic() < deadline:
        result = jobs.get(job_id)
        if result["status"] != "RUNNING":
            return result
        time.sleep(0.01)
    raise AssertionError("job did not finish")


class ValidationTests(unittest.TestCase):
    def test_only_configured_keywords(self):
        capture = fixture()
        capture["rows"][0]["keywords"] = ["세라마이드", "나이아신아마이드"]
        self.assertEqual(validate_capture(capture)["rows"][0]["keywords"], ["세라마이드", "나이아신아마이드"])
        for invalid in (["bad,word"], ["시카", "시카"], "PDRN", [123]):
            capture["rows"][0]["keywords"] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                validate_capture(capture)
    def test_observed_b_prefix_product(self):
        capture = fixture()
        row = capture["rows"][0]
        row["product_id"] = "B000000238528"
        row["product_url"] = "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=B000000238528"
        self.assertEqual(validate_capture(capture)["rows"][0]["product_id"], "B000000238528")
    def test_review_summary_values(self):
        capture = fixture()
        capture["rows"][0].update(review_count=44987, rating=4.9)
        self.assertEqual(validate_capture(capture)["rows"][0]["rating"], 4.9)
        for field, value in (("rating", 5.5), ("rating", float("nan")), ("review_count", -1), ("review_count", True)):
            invalid = fixture()
            invalid["rows"][0][field] = value
            with self.subTest(field=field, value=value), self.assertRaises(ValueError):
                validate_capture(invalid)
    def test_all_configured_category_sources(self):
        self.assertEqual(len(CATEGORIES), 10)
        for category, config in CATEGORIES.items():
            with self.subTest(category=category):
                capture = fixture()
                capture["category_code"] = category
                capture["source_url"] = config["source_url"]
                self.assertEqual(validate_capture(capture)["category_code"], category)
                capture["source_url"] = "https://evil.example"
                with self.assertRaises(ValueError): validate_capture(capture)
    def test_skincare_source_must_match(self):
        capture = fixture()
        capture["category_code"] = "skincare"
        with self.assertRaises(ValueError): validate_capture(capture)
        capture["source_url"] = CATEGORIES["skincare"]["source_url"]
        self.assertEqual(validate_capture(capture)["category_code"], "skincare")
    def test_complete_capture(self):
        self.assertEqual(len(validate_capture(fixture())["rows"]), 100)

    def test_product_category_capture(self):
        capture = fixture()
        capture["rows"][0]["product_category"] = "스킨케어"
        self.assertEqual(validate_capture(capture)["rows"][0]["product_category"], "스킨케어")
        for invalid in (None, 123, "분" * 101):
            capture["rows"][0]["product_category"] = invalid
            with self.subTest(value=invalid), self.assertRaises(ValueError):
                validate_capture(capture)

    def test_missing_duplicate_price_image_and_wrong_source(self):
        variants = []
        v = fixture(); v["rows"].pop(); variants.append(v)
        v = fixture(); v["rows"][1]["rank"] = 1; variants.append(v)
        v = fixture(); v["rows"][1]["product_id"] = v["rows"][0]["product_id"]; variants.append(v)
        for field in ("image_url", "sale_price"):
            v = fixture(); v["rows"][0][field] = "x"; variants.append(v)
        v = fixture(); v["source_url"] = "https://evil.example"; variants.append(v)
        v = fixture(); v["ranking_date"] = "2026-11-03"; variants.append(v)
        v = fixture(); v["rows"][0]["product_url"] = "https://evil.example"; variants.append(v)
        for capture in variants:
            with self.subTest(capture=str(capture)[:40]), self.assertRaises(ValueError):
                validate_capture(capture)


class JobsTests(unittest.TestCase):
    def test_category_job_is_isolated(self):
        release = threading.Event()
        def run(category):
            release.wait(2)
            capture = fixture()
            capture["category_code"] = category
            capture["source_url"] = CATEGORIES[category]["source_url"]
            return capture
        jobs = Jobs(run)
        first = jobs.start("skincare")
        self.assertEqual(jobs.start("skincare")["id"], first["id"])
        with self.assertRaises(ValueError): jobs.start("overall")
        release.set()
        result = completed(jobs, first["id"])
        self.assertEqual(result["capture"]["category_code"], "skincare")

    def test_wrong_category_result_fails(self):
        jobs = Jobs(lambda category: fixture())
        result = completed(jobs, jobs.start("skincare")["id"])
        self.assertEqual(result["status"], "FAILED")
        self.assertNotIn("capture", result)
    def test_duplicate_start_reuses_running_browser(self):
        release = threading.Event()
        calls = []
        def run():
            calls.append(True); release.wait(2); return fixture()
        jobs = Jobs(run)
        first = jobs.start(); second = jobs.start()
        self.assertEqual(first["id"], second["id"])
        self.assertTrue(second["reused"])
        release.set()
        self.assertEqual(completed(jobs, first["id"])["status"], "COMPLETE")
        self.assertEqual(len(calls), 1)

    def test_keyword_rules_passed_to_runner_and_isolated(self):
        release = threading.Event()
        rules = [{"display": "재생", "includes": ["피디알엔"]}]
        received = []
        def run(category, keyword_rules):
            received.append((category, keyword_rules))
            release.wait(2)
            capture = fixture()
            capture["rows"][0]["keywords"] = ["재생"]
            capture["rows"][0]["review_count"] = 0
            return capture
        jobs = Jobs(run)
        first = jobs.start("overall", rules)
        self.assertTrue(jobs.start("overall", rules)["reused"])
        with self.assertRaises(ValueError):
            jobs.start("overall", [])
        release.set()
        result = completed(jobs, first["id"])
        self.assertEqual(received, [("overall", rules)])
        self.assertEqual(result["capture"]["rows"][0]["keywords"], ["재생"])
        self.assertEqual(result["coverage"], {"total":100,"manufacturers":0,"sellers":0,"ingredients":1,"reviews":1,"ratings":0})

    def test_bad_capture_never_completes(self):
        capture = fixture(); capture["rows"].pop()
        jobs = Jobs(lambda: capture)
        result = completed(jobs, jobs.start()["id"])
        self.assertEqual(result["status"], "FAILED")
        self.assertNotIn("capture", result)

    def test_driver_errors_return_safe_message(self):
        def run(): raise KeyError("private driver trace")
        jobs = Jobs(run)
        result = completed(jobs, jobs.start()["id"])
        self.assertEqual(result["status"], "FAILED")
        self.assertNotIn("private driver trace", result["message"])

    def test_history_is_bounded(self):
        jobs = Jobs(fixture)
        for _ in range(10): completed(jobs, jobs.start()["id"])
        self.assertEqual(len(jobs.jobs), 8)


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.token = "test-token-with-sufficient-length"
        self.jobs = Jobs(fixture)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(self.jobs, self.token))
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.thread.join()

    def request(self, path, data=None, authorized=True, headers=None):
        h = {"Authorization": "Bearer " + self.token} if authorized else {}
        h.update(headers or {})
        request = Request(self.base + path, data=data, headers=h)
        try:
            with urlopen(request, timeout=3) as response:
                return response.status, json.load(response)
        except HTTPError as error:
            return error.code, json.load(error)

    def test_no_token_origin_and_foreign_host_rejected(self):
        self.assertEqual(self.request("/health", authorized=False)[0], 401)
        self.assertEqual(self.request("/health", headers={"Origin": "https://evil.example"})[0], 403)
        self.assertEqual(self.request("/health", headers={"Host": "evil.example"})[0], 403)
        self.assertEqual(self.request("/health")[1]["service"], "cosmetics-rank-selenium")

    def test_http_job_roundtrip(self):
        status, job = self.request("/jobs", b"{}")
        self.assertEqual(status, 202)
        completed(self.jobs, job["id"])
        status, result = self.request("/jobs/" + job["id"])
        self.assertEqual(status, 200)
        self.assertEqual(result["status"], "COMPLETE")
        self.assertEqual(len(result["capture"]["rows"]), 100)

    def test_custom_urls_bad_json_and_large_body_rejected(self):
        self.assertEqual(self.request("/jobs", b'{"category_code":"unknown"}')[0], 400)
        self.assertEqual(self.request("/jobs", b'{"url":"https://evil.example"}')[0], 400)
        self.assertEqual(self.request("/jobs", b"bad json")[0], 400)
        self.assertEqual(self.request("/jobs", b"x" * 65537)[0], 413)
        self.assertEqual(self.request("/unknown")[0], 404)

    def test_authenticated_shutdown_stops_server(self):
        self.assertEqual(self.request('/shutdown', b'{}')[0], 200)
        self.thread.join(timeout=3)
        self.assertFalse(self.thread.is_alive())


if __name__ == "__main__":
    unittest.main()
