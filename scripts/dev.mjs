// Start the local Selenium helper alongside Wrangler. No global installation.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
const token = readFileSync(".dev.vars", "utf8")
  .match(/^LOCAL_DEV_TOKEN=(.+)$/m)?.[1]
  .trim();
if (!token) throw Error("pnpm setup:local을 먼저 실행하세요.");
const candidates = [
  process.env.OLIVERANK_PYTHON,
  path.join(
    homedir(),
    ".cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe",
  ),
  "python3",
  "python",
].filter(Boolean);
const python = candidates.find(
  (candidate) =>
    spawnSync(
      candidate,
      ["-c", "import sys;sys.exit(0 if sys.version_info >= (3,10) else 1)"],
      { stdio: "ignore", windowsHide: true },
    ).status === 0,
);
if (!python)
  throw Error(
    "Python 3.10 이상을 설치하거나 OLIVERANK_PYTHON 경로를 설정하세요.",
  );
const packages = path.join(root, ".local-browser", "python-deps");
mkdirSync(packages, { recursive: true });
const env = {
  ...process.env,
  PYTHONPATH:
    packages +
    (process.env.PYTHONPATH ? path.delimiter + process.env.PYTHONPATH : ""),
  LOCAL_DEV_TOKEN: token,
};
const chrome =
  process.env.OLIVERANK_CHROME_BINARY ||
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].find(existsSync);
if (chrome) env.OLIVERANK_CHROME_BINARY = chrome;
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: root,
      env,
      stdio: "inherit",
      windowsHide: true,
    });
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(Error("실행 실패: " + command)),
    );
  });
}
if (
  spawnSync(
    python,
    ["-c", 'import selenium;assert selenium.__version__=="4.52.0"'],
    { env, stdio: "ignore", windowsHide: true },
  ).status !== 0
) {
  console.log("Selenium 실행 환경을 준비합니다 (최초 1회).");
  await run(python, [
    "-m",
    "pip",
    "install",
    "--target",
    packages,
    "-r",
    "scripts/requirements-selenium.txt",
  ]);
}
const headers = { Authorization: "Bearer " + token };
async function ready() {
  try {
    const r = await fetch("http://127.0.0.1:8790/health", {
      headers,
      signal: AbortSignal.timeout(1000),
    });
    const d = await r.json();
    return r.ok && d.service === "oliverank-selenium" && d.protocol === 1;
  } catch {
    return false;
  }
}
let helper;
let worker;
let stopping = false;
let shutdownPromise;
async function killOwned(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32")
    await new Promise((resolve) => {
      const killer = spawn(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        { stdio: "ignore", windowsHide: true },
      );
      killer.once("error", resolve);
      killer.once("exit", resolve);
    });
  else child.kill("SIGTERM");
}
function stop() {
  if (stopping) return shutdownPromise;
  stopping = true;
  shutdownPromise = (async () => {
    if (helper?.pid && helper.exitCode === null) {
      try {
        await fetch("http://127.0.0.1:8790/shutdown", {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: "{}",
          signal: AbortSignal.timeout(4000),
        });
      } catch {
        /* fall back to killing only the owned tree */
      }
      for (let i = 0; i < 30 && helper.exitCode === null; i++)
        await new Promise((resolve) => setTimeout(resolve, 100));
      await killOwned(helper);
    }
    await killOwned(worker);
  })();
  return shutdownPromise;
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
try {
  if (!(await ready())) {
    helper = spawn(
      python,
      ["-u", "-X", "utf8", "scripts/collector_service.py"],
      { cwd: root, env, stdio: "inherit", windowsHide: true },
    );
    let failed;
    helper.once("error", (e) => {
      failed = e;
    });
    helper.once("exit", (code) => {
      if (!stopping) failed = Error("수집 서비스가 종료됐습니다: " + code);
    });
    let available = false;
    for (let i = 0; i < 30; i++) {
      if (failed) throw failed;
      if (await ready()) {
        available = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    if (!available)
      throw Error(
        "8790 포트의 수집 서비스를 시작하지 못했습니다. 이미 실행 중인 앱을 확인하세요.",
      );
  } else console.log("이미 실행 중인 로컬 수집 서비스를 사용합니다.");
  const port = Number(process.env.OLIVERANK_PORT || 8787);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw Error("앱 포트가 잘못됐습니다.");
  worker = spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { cwd: root, env: { ...process.env }, stdio: "inherit", windowsHide: true },
  );
  await new Promise((resolve, reject) => {
    worker.once("error", reject);
    worker.once("exit", (code) => {
      if (code && !stopping) reject(Error("Wrangler 실행 실패"));
      else resolve();
    });
    helper?.once("exit", () => {
      if (!stopping) {
        stop();
        reject(Error("수집 서비스가 중단됐습니다."));
      }
    });
  });
} finally {
  await stop();
}
