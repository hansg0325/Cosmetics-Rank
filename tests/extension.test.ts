import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import { readWhenReady } from "../extension/capture-function.js";
import { requestBrowserCapture } from "../src/client/browserBridge";
const local = "http://127.0.0.1:8787";
const sender = {
  id: "extension-id",
  frameId: 0,
  url: local + "/",
  tab: { id: 1 },
};
function chromeMock() {
  return {
    runtime: { id: "extension-id", onMessage: { addListener: vi.fn() } },
    tabs: {
      create: vi.fn(async () => ({ id: 2 })),
      get: vi.fn(async () => ({ id: 2, status: "complete" })),
      remove: vi.fn(async () => {}),
      update: vi.fn(async () => {}),
      onUpdated: { addListener: vi.fn(), removeListener: vi.fn() },
      onRemoved: { addListener: vi.fn(), removeListener: vi.fn() },
    },
    scripting: {
      executeScript: vi.fn(async () => [
        {
          result: {
            rows: Array.from({ length: 100 }, (_, rank) => ({
              rank: rank + 1,
            })),
          },
        },
      ]),
    },
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.resetModules();
});
describe("확장 프로그램 수집 제어", () => {
  it("Chrome처럼 함수만 직렬화해 실행해도 100행을 반환", async () => {
    const cards = Array.from(
      { length: 100 },
      (_, i) =>
        `<li><div class="prd_info"><span class="thumb_flag best">${i + 1}</span><div class="prd_name"><a href="/store/goods/getGoodsDetail.do?goodsNo=A${String(i + 1).padStart(12, "0")}"><span class="tx_brand">브랜드</span><p class="tx_name">상품 ${i + 1}</p></a></div></div></li>`,
    ).join("");
    const { document } = parseHTML(
      `<div id="Container"><li class="on"><button title="선택됨">전체</button></li><ul class="cate_prd_list">${cards}</ul></div>`,
    );
    const result = await runInNewContext(`(${readWhenReady.toString()})()`, {
      document,
      location: {
        href: "https://www.oliveyoung.co.kr/store/main/getBestList.do",
      },
      URL,
      Date,
      Intl,
      setTimeout,
      clearTimeout,
    });
    expect(result.rows).toHaveLength(100);
    expect(result.format).toBe("cosmetics-rank-browser-v1");
    expect(JSON.stringify(result)).not.toMatch(
      /image_url|list_price|sale_price/,
    );
  });
  it("접속 확인 화면은 대기 제한 후 관찰 종료 및 실패", async () => {
    const { document } = parseHTML("<h1>잠시만 기다려 주세요</h1>");
    const disconnect = vi.fn();
    class Observer {
      observe() {}
      disconnect = disconnect;
    }
    await expect(
      runInNewContext(`(${readWhenReady.toString()})()`, {
        document,
        location: {
          href: "https://www.oliveyoung.co.kr/store/main/getBestList.do",
        },
        URL,
        Date,
        Intl,
        MutationObserver: Observer,
        setTimeout: (fn: () => void) => {
          fn();
          return 0;
        },
        clearTimeout: vi.fn(),
      }),
    ).rejects.toThrow("전체 랭킹");
    expect(disconnect).toHaveBeenCalled();
  });
  it("요청 시 새 탭에서 읽고 성공한 자체 탭만 닫기", async () => {
    const chrome = chromeMock();
    vi.stubGlobal("chrome", chrome);
    const { collect } = await import("../extension/background.js");
    const result = await collect(sender);
    expect(result.capture.rows).toHaveLength(100);
    expect(chrome.tabs.create).toHaveBeenCalledWith({
      url: "https://www.oliveyoung.co.kr/store/main/getBestList.do",
      active: false,
    });
    expect(chrome.scripting.executeScript.mock.calls[0]).toMatchObject([
      { target: { tabId: 2 }, func: expect.any(Function) },
    ]);
    expect(chrome.tabs.remove).toHaveBeenCalledWith(2);
  });
  it.each([
    { ...sender, url: "https://evil.example/" },
    { ...sender, url: "http://127.0.0.1:9000/" },
    { ...sender, frameId: 1 },
    { ...sender, id: "different" },
  ])("허용되지 않은 발신자 거부 %#", async (s) => {
    const chrome = chromeMock();
    vi.stubGlobal("chrome", chrome);
    const { collect } = await import("../extension/background.js");
    await expect(collect(s)).rejects.toThrow("허용된");
    expect(chrome.tabs.create).not.toHaveBeenCalled();
  });
  it("불완전/차단 결과에서는 저장용 결과를 반환하지 않고 탭 표시", async () => {
    const chrome = chromeMock();
    chrome.scripting.executeScript.mockResolvedValue([
      { result: { rows: [] } },
    ]);
    vi.stubGlobal("chrome", chrome);
    const { collect } = await import("../extension/background.js");
    await expect(collect(sender)).rejects.toThrow("100개");
    expect(chrome.tabs.update).toHaveBeenCalledWith(2, { active: true });
    expect(chrome.tabs.remove).not.toHaveBeenCalled();
  });
  it("중복 실행 방지", async () => {
    const chrome = chromeMock();
    let release!: () => void;
    chrome.scripting.executeScript.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve([
              {
                result: {
                  rows: Array.from({ length: 100 }, (_, rank) => ({ rank })),
                },
              },
            ]);
        }),
    );
    vi.stubGlobal("chrome", chrome);
    const { collect } = await import("../extension/background.js");
    const first = collect(sender);
    await vi.waitFor(() =>
      expect(chrome.scripting.executeScript).toHaveBeenCalled(),
    );
    await expect(collect(sender)).rejects.toThrow("이미 수집");
    release();
    await first;
  });
  it("설치 권한이 scripting과 대상 호스트로 한정", () => {
    const manifest = JSON.parse(
      readFileSync("extension/manifest.json", "utf8"),
    );
    expect(manifest.permissions).toEqual(["scripting"]);
    expect(manifest.host_permissions).toEqual([
      "https://www.oliveyoung.co.kr/*",
    ]);
    expect(JSON.stringify(manifest)).not.toMatch(
      /<all_urls>|cookies|alarms|history/,
    );
  });
});
describe("앱 연결 메시지", () => {
  it("동일 창·Origin·요청 ID·응답 종류를 확인", async () => {
    const listeners = new Set<(event: unknown) => void>();
    const win = {
      addEventListener: (_name: string, fn: (event: unknown) => void) =>
        listeners.add(fn),
      removeEventListener: (_name: string, fn: (event: unknown) => void) =>
        listeners.delete(fn),
      postMessage: vi.fn(),
    };
    vi.stubGlobal("window", win);
    vi.stubGlobal("location", { origin: local });
    win.postMessage.mockImplementation((message) => {
      for (const fn of [...listeners]) {
        fn({
          source: {},
          origin: local,
          data: {
            channel: "COSMETICS_RANK_EXTENSION_V1",
            type: "RESULT",
            id: message.id,
            capture: "bad",
          },
        });
        fn({
          source: win,
          origin: "https://evil.example",
          data: {
            channel: "COSMETICS_RANK_EXTENSION_V1",
            type: "RESULT",
            id: message.id,
            capture: "bad",
          },
        });
        fn({
          source: win,
          origin: local,
          data: {
            channel: "COSMETICS_RANK_EXTENSION_V1",
            type: message.type === "PING" ? "PONG" : "RESULT",
            id: message.id,
            capture: { rows: 100 },
          },
        });
      }
    });
    await expect(requestBrowserCapture()).resolves.toEqual({ rows: 100 });
    expect(listeners.size).toBe(0);
  });
  it("미설치 때 설치 안내 후 중단", async () => {
    vi.useFakeTimers();
    const remove = vi.fn();
    vi.stubGlobal("location", { origin: local });
    vi.stubGlobal("window", {
      addEventListener: vi.fn(),
      removeEventListener: remove,
      postMessage: vi.fn(),
    });
    const result = expect(requestBrowserCapture()).rejects.toThrow(
      "확장 프로그램",
    );
    await vi.advanceTimersByTimeAsync(1001);
    await result;
    expect(remove).toHaveBeenCalled();
  });
  it("content bridge는 실제 버튼 클릭이 없는 COLLECT와 외부 Origin을 거부", async () => {
    const handlers: Record<string, (e: unknown) => void> = {};
    const post = vi.fn(),
      send = vi.fn(async () => ({ capture: "test" }));
    class FakeElement {
      closest() {
        return true;
      }
    }
    const win = {
      top: null as unknown,
      postMessage: post,
      addEventListener: (type: string, fn: (e: unknown) => void) =>
        (handlers[type] = fn),
    };
    win.top = win;
    runInNewContext(readFileSync("extension/bridge.js", "utf8"), {
      window: win,
      document: {
        addEventListener: (type: string, fn: (e: unknown) => void) =>
          (handlers[type] = fn),
      },
      location: { origin: local },
      Element: FakeElement,
      Date,
      chrome: { runtime: { sendMessage: send } },
    });
    const event = {
      source: win,
      origin: local,
      data: {
        channel: "COSMETICS_RANK_APP_V1",
        type: "COLLECT",
        id: "11111111-1111-1111-1111-111111111111",
      },
    };
    await handlers.message(event);
    expect(send).not.toHaveBeenCalled();
    handlers.click({ isTrusted: false, target: new FakeElement() });
    await handlers.message(event);
    expect(send).not.toHaveBeenCalled();
    handlers.click({ isTrusted: true, target: new FakeElement() });
    await handlers.message({ ...event, origin: "https://evil.example" });
    expect(send).not.toHaveBeenCalled();
    await handlers.message(event);
    expect(send).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ type: "RESULT", capture: "test" }),
      local,
    );
    await handlers.message(event);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
