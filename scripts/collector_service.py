"""Loopback-only authenticated Selenium helper; the public API stays on Hono."""
import argparse
import hmac
import json
import os
import re
import signal
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent.parent
SOURCE = "https://www.oliveyoung.co.kr/store/main/getBestList.do"


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def validate_capture(capture):
    if set(capture) != {"format", "source_url", "collected_at", "ranking_date", "category_code", "rows"}:
        raise ValueError("수집 데이터 형식이 잘못됐습니다.")
    if capture["format"] != "oliverank-browser-v1" or capture["source_url"] != SOURCE or capture["category_code"] != "overall":
        raise ValueError("전체 랭킹 출처를 확인할 수 없습니다.")
    at = datetime.fromisoformat(capture["collected_at"].replace("Z", "+00:00"))
    if at.utcoffset() != timedelta(0) or at.astimezone(timezone(timedelta(hours=9))).date().isoformat() != capture["ranking_date"]:
        raise ValueError("수집 시각과 KST 날짜가 다릅니다.")
    rows = capture["rows"]
    if len(rows) != 100 or {r["rank"] for r in rows} != set(range(1, 101)) or len({r["product_id"] for r in rows}) != 100:
        raise ValueError("중복 없는 전체 순위 1~100이 필요합니다.")
    for row in rows:
        if set(row) != {"rank", "product_id", "brand_name", "product_name", "product_url"}:
            raise ValueError("허용되지 않은 상품 필드입니다.")
        if type(row["rank"]) is not int or not re.fullmatch(r"A\d{12}", row["product_id"]):
            raise ValueError("상품 ID 또는 순위 오류입니다.")
        if not all(isinstance(row[k], str) and 0 < len(row[k].strip()) <= 300 for k in ("brand_name", "product_name")):
            raise ValueError("상품명 또는 브랜드 오류입니다.")
        if row["product_url"] != f'https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo={row["product_id"]}':
            raise ValueError("상품 링크가 ID와 다릅니다.")
    return capture


def kill_tree(process):
    if process.poll() is not None:
        return
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"], capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
    else:
        try:
            os.killpg(process.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass


class SeleniumRunner:
    def __init__(self):
        self.lock = threading.Lock()
        self.process = None

    def __call__(self):
        kwargs = {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {"start_new_session": True}
        process = subprocess.Popen([sys.executable, "-u", "-X", "utf8", str(ROOT / "scripts/collect-rankings.py")], cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", **kwargs)
        with self.lock:
            self.process = process
        try:
            try:
                stdout, _stderr = process.communicate(timeout=95)
            except subprocess.TimeoutExpired:
                kill_tree(process)
                process.communicate()
                raise RuntimeError("Chrome 수집 시간이 초과됐습니다. 잠시 후 다시 시도하세요.")
            capture = None
            message = None
            for line in stdout.splitlines():
                if line.startswith("OLIVERANK_CAPTURE "):
                    capture = json.loads(line.removeprefix("OLIVERANK_CAPTURE "))
                if line.startswith("OLIVERANK_ERROR "):
                    message = json.loads(line.removeprefix("OLIVERANK_ERROR ")).get("message")
            if process.returncode != 0 or capture is None:
                raise RuntimeError(message or "Selenium 실행에 실패했습니다. Chrome 설치와 접속 상태를 확인하세요.")
            return capture
        finally:
            kill_tree(process)
            with self.lock:
                self.process = None

    def close(self):
        with self.lock:
            if self.process is not None:
                kill_tree(self.process)


class Jobs:
    def __init__(self, runner):
        self.runner = runner
        self.lock = threading.Lock()
        self.jobs = {}

    def start(self):
        with self.lock:
            for job in self.jobs.values():
                if job["status"] == "RUNNING":
                    return {"id": job["id"], "status": job["status"], "reused": True}
            # Keep a bounded in-memory history, never cookie/profile data.
            while len(self.jobs) >= 8:
                del self.jobs[next(iter(self.jobs))]
            job_id = str(uuid.uuid4())
            self.jobs[job_id] = {"id": job_id, "status": "RUNNING", "started_at": utc_now()}
        threading.Thread(target=self._run, args=(job_id,), daemon=True).start()
        return {"id": job_id, "status": "RUNNING", "reused": False}

    def _run(self, job_id):
        try:
            capture = validate_capture(self.runner())
            update = {"status": "COMPLETE", "capture": capture}
        except Exception as error:
            # No raw driver trace or tokens are returned over HTTP.
            message = str(error) if isinstance(error, (RuntimeError, ValueError)) else "수집 중 오류가 발생했습니다. 잠시 후 다시 시도하세요."
            update = {"status": "FAILED", "error": "COLLECTION_FAILED", "message": message[:400]}
        with self.lock:
            self.jobs[job_id].update(update, finished_at=utc_now())

    def get(self, job_id):
        with self.lock:
            job = self.jobs.get(job_id)
            return dict(job) if job else None


def handler_for(jobs, token):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            pass

        def send_json(self, status, value):
            data = json.dumps(value, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def authorized(self):
            port = self.server.server_address[1]
            if self.headers.get("Host") not in (f"127.0.0.1:{port}", f"localhost:{port}") or self.headers.get("Origin"):
                self.send_json(403, {"error": "FORBIDDEN"})
                return False
            if not hmac.compare_digest(self.headers.get("Authorization", ""), "Bearer " + token):
                self.send_json(401, {"error": "UNAUTHORIZED"})
                return False
            return True

        def do_GET(self):
            if not self.authorized():
                return
            path = urlsplit(self.path).path
            if path == "/health":
                self.send_json(200, {"service": "oliverank-selenium", "protocol": 1})
            elif re.fullmatch(r"/jobs/[0-9a-f-]{36}", path):
                job = jobs.get(path.split("/")[-1])
                self.send_json(200 if job else 404, job or {"error": "NOT_FOUND"})
            else:
                self.send_json(404, {"error": "NOT_FOUND"})

        def do_POST(self):
            if not self.authorized():
                return
            if self.path not in ("/jobs", "/shutdown"):
                self.send_json(404, {"error": "NOT_FOUND"})
                return
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 <= size <= 1024:
                    # Drain a bounded small body before rejecting it. Closing with
                    # unread bytes can reset the response on Windows sockets.
                    if 1024 < size <= 65536:
                        self.connection.settimeout(2)
                        try:
                            self.rfile.read(size)
                        except TimeoutError:
                            pass
                    self.send_json(413, {"error": "TOO_LARGE"})
                    return
                if json.loads(self.rfile.read(size) or b"{}") != {}:
                    raise ValueError()
            except (ValueError, json.JSONDecodeError):
                self.send_json(400, {"error": "INVALID_BODY"})
                return
            if self.path == "/shutdown":
                self.send_json(200, {"status": "STOPPING"})
                threading.Thread(target=self.server.shutdown, daemon=True).start()
            else:
                self.send_json(202, jobs.start())

        def do_OPTIONS(self):
            self.send_json(403, {"error": "FORBIDDEN"})
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8790)
    args = parser.parse_args()
    token = os.environ.get("LOCAL_DEV_TOKEN", "")
    if len(token) < 16:
        raise SystemExit("LOCAL_DEV_TOKEN 설정이 필요합니다.")
    runner = SeleniumRunner()
    server = ThreadingHTTPServer(("127.0.0.1", args.port), handler_for(Jobs(runner), token))
    server.daemon_threads = True
    print(f"OliveRank Selenium ready on 127.0.0.1:{args.port}", flush=True)
    def shutdown(_signum, _frame):
        runner.close()
        raise KeyboardInterrupt()
    signal.signal(signal.SIGTERM, shutdown)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        runner.close()
        server.server_close()


if __name__ == "__main__":
    main()
