import { describe, expect, it, vi } from "vitest";
vi.mock("../src/scheduler/browser", () => ({
  rankingScript: () => "rank",
  detailScript: () => "detail",
}));
import { CloudCollector, type CollectorEnv } from "../src/scheduler/collector";
import {
  billingPeriod,
  canReserve,
  chunksByBytes,
  MONTHLY_BROWSER_LIMIT_MS,
} from "../src/scheduler/budget";
import scheduler from "../src/scheduler/index";
function setup(db?: D1Database) {
  const data = new Map<string, unknown>();
  const storage = {
    get: async (key: string) => data.get(key),
    put: async (key: string | Record<string, unknown>, value?: unknown) => {
      if (typeof key === "string") data.set(key, structuredClone(value));
      else
        Object.entries(key).forEach(([k, v]) =>
          data.set(k, structuredClone(v)),
        );
    },
    delete: async (keys: string | string[]) => {
      for (const key of [keys].flat()) data.delete(key);
    },
    list: async ({ prefix }: { prefix: string }) =>
      new Map([...data].filter(([key]) => key.startsWith(prefix))),
    setAlarm: vi.fn(),
    deleteAlarm: vi.fn(),
  };
  const browser = {
    script: vi.fn(),
    closeSession: vi.fn(async () => ({ status: "closed" })),
    getSession: vi.fn(async () => null),
  };
  const ctx = {
    storage,
    blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
  } as unknown as DurableObjectState;
  const collector = new CloudCollector(ctx, {
    BROWSER: browser,
    DB: db,
  } as unknown as CollectorEnv);
  return { data, browser, collector, storage };
}
const start = (c: CloudCollector) =>
  c.fetch(
    new Request("https://collector/start", {
      method: "POST",
      body: JSON.stringify({ dryRun: true }),
    }),
  );
describe("single cloud browser lifecycle", () => {
  it("reads known diagnostic products without fetching rankings or writing D1", async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          first: async () => ({
            product_name: "진단 상품",
            brand_name: "검증",
          }),
        }),
      }),
    } as unknown as D1Database;
    const { collector, data, browser } = setup(db);
    const response = await collector.fetch(
      new Request("https://collector/start", {
        method: "POST",
        body: JSON.stringify({
          dryRun: true,
          diagnosticOnly: true,
          detailLimit: 1,
          preferredIds: ["A000000242173"],
        }),
      }),
    );
    expect(response.status).toBe(202);
    expect(data.get("active")).toMatchObject({
      phase: "details",
      rankingCount: 0,
      targetIds: ["A000000242173"],
    });
    expect(browser.script).not.toHaveBeenCalled();
  });
  it("does not allow diagnostic flags to reduce a production collection", async () => {
    const { collector, data } = setup();
    await collector.fetch(
      new Request("https://collector/start", {
        method: "POST",
        body: JSON.stringify({
          diagnosticOnly: true,
          detailLimit: 1,
          preferredIds: ["A000000242173"],
        }),
      }),
    );
    expect(data.get("active")).toMatchObject({
      phase: "rankings",
      detailLimit: 1000,
      preferredIds: [],
    });
  });
  it("limits a real cron smoke test to 20 details and requires its explicit mode", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ jobId: "smoke" }, { status: 202 }),
    );
    const env = {
      COLLECTOR: { idFromName: () => "singleton", get: () => ({ fetch }) },
    } as unknown as CollectorEnv;
    await scheduler.scheduled(
      { cron: "* * * * *" } as ScheduledController,
      env,
    );
    expect(fetch).not.toHaveBeenCalled();
    env.SCHEDULE_SMOKE = "true";
    await scheduler.scheduled(
      { cron: "* * * * *" } as ScheduledController,
      env,
    );
    expect(fetch).toHaveBeenCalledWith(
      "https://collector/start",
      expect.objectContaining({
        body: JSON.stringify({
          trigger: "cron",
          dryRun: true,
          detailLimit: 20,
        }),
      }),
    );
  });
  it("preserves a timed-out checkpoint and resumes without repeating completed details", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    const run = data.get("active") as {
      id: string;
      phase: string;
      detailIndex: number;
    };
    run.phase = "details";
    run.detailIndex = 10;
    Object.assign(run, {
      targetIds: Array.from({ length: 12 }, (_, i) => String(i)),
      sessionId: "session",
      status: "FAILED",
      error: "BROWSER_API_408",
    });
    browser.closeSession.mockRejectedValue(Error("404 Session not found"));
    browser.getSession.mockRejectedValue(Error("404 Session not found"));
    await collector.alarm();
    expect(data.has("active")).toBe(false);
    expect(data.has(`checkpoint:${run.id}`)).toBe(true);
    const result = await collector.fetch(
      new Request("https://collector/resume", {
        method: "POST",
        body: JSON.stringify({ id: run.id }),
      }),
    );
    expect(result.status).toBe(202);
    expect(await result.json()).toMatchObject({ resumedFrom: 10 });
    expect(data.get("active")).toMatchObject({
      status: "RUNNING",
      detailIndex: 10,
      lastReportedMs: 0,
      resumeCount: 1,
    });
    expect(browser.script).not.toHaveBeenCalled();
  });
  it("does not acquire another browser after restoring an uncertain in-flight launch", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    const active = data.get("active") as { unknownSessionUntil: number };
    active.unknownSessionUntil = Date.now() + 60000;
    await collector.alarm();
    expect(browser.script).not.toHaveBeenCalled();
    expect(data.get("active")).toMatchObject({
      status: "FAILED",
      closeStatus: "AWAITING_IDLE_TIMEOUT",
    });
  });
  it("waits for asynchronous closure before declaring success", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    const run = data.get("active") as { phase: string; sessionId: string };
    run.phase = "details";
    run.sessionId = "session";
    browser.closeSession.mockResolvedValueOnce({ status: "closing" });
    browser.getSession.mockResolvedValue({} as never);
    await collector.alarm();
    expect(data.get("active")).toMatchObject({
      status: "RUNNING",
      closeStatus: "CLOSE_RETRY_REQUIRED",
    });
    browser.getSession.mockResolvedValue(null);
    await collector.alarm();
    expect(data.has("active")).toBe(false);
    expect(data.get("history")).toMatchObject([
      { status: "COMPLETE", closeStatus: "CLOSED" },
    ]);
    expect(browser.script).not.toHaveBeenCalled();
  });
  it("dispatches the daily cron directly to the same collector and ignores stale schedules", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ jobId: "scheduled" }, { status: 202 }),
    );
    const idFromName = vi.fn(() => "singleton");
    const env = {
      COLLECTOR: { idFromName, get: () => ({ fetch }) },
    } as unknown as CollectorEnv;
    await scheduler.scheduled(
      { cron: "*/5 * * * *" } as ScheduledController,
      env,
    );
    expect(fetch).not.toHaveBeenCalled();
    await scheduler.scheduled(
      { cron: "0 21 * * *" } as ScheduledController,
      env,
    );
    expect(idFromName).toHaveBeenCalledWith("single-browser");
    expect(fetch).toHaveBeenCalledWith(
      "https://collector/start",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ trigger: "cron" }),
      }),
    );
  });
  it("starts a scheduled run only once per Korean date, even after completion", async () => {
    const { collector } = setup();
    const scheduled = () =>
      collector.fetch(
        new Request("https://collector/start", {
          method: "POST",
          body: JSON.stringify({ trigger: "cron", dryRun: true }),
        }),
      );
    expect((await scheduled()).status).toBe(202);
    await collector.fetch(
      new Request("https://collector/cancel", { method: "POST" }),
    );
    await collector.alarm();
    expect(await (await scheduled()).json()).toEqual({
      alreadyStartedToday: true,
    });
  });
  it("holds the lock after an ambiguous first launch until idle expiry", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    browser.script.mockRejectedValue(Error("network"));
    await collector.alarm();
    expect(data.has("active")).toBe(true);
    expect(await (await start(collector)).json()).toMatchObject({
      alreadyRunning: true,
    });
    const active = data.get("active") as { unknownSessionUntil: number };
    active.unknownSessionUntil = Date.now() - 1;
    await collector.alarm();
    expect(data.has("active")).toBe(false);
    expect(browser.script).toHaveBeenCalledTimes(1);
  });
  it("shares one active run across repeated starts", async () => {
    const { collector, browser } = setup();
    const first = (await (await start(collector)).json()) as { jobId: string };
    expect(await (await start(collector)).json()).toMatchObject({
      jobId: first.jobId,
      alreadyRunning: true,
    });
    expect(browser.script).not.toHaveBeenCalled();
  });
  it("refuses a launch that would exceed the monthly reservation", async () => {
    const { collector, data, browser } = setup();
    data.set(`budget:${billingPeriod()}`, {
      usedMs: MONTHLY_BROWSER_LIMIT_MS - 1,
    });
    expect((await start(collector)).status).toBe(429);
    expect(browser.script).not.toHaveBeenCalled();
  });
  it("closes a session on failure and releases its lock", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    browser.script.mockResolvedValue(
      new Response(JSON.stringify({ success: false }), {
        status: 500,
        headers: {
          "cf-browser-session-id": "session",
          "x-browser-ms-used": "1234",
        },
      }),
    );
    await collector.alarm();
    expect(browser.closeSession).toHaveBeenCalledWith("session");
    expect(data.has("active")).toBe(false);
    expect(data.get("history")).toMatchObject([
      { status: "FAILED", closeStatus: "CLOSED" },
    ]);
  });
  it("retains the lock while closure cannot be confirmed, and retries cleanup only", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    const active = data.get("active") as { status: string; sessionId: string };
    active.status = "FAILED";
    active.sessionId = "session";
    browser.closeSession.mockRejectedValue(Error("network"));
    browser.getSession.mockResolvedValue({} as never);
    await collector.alarm();
    expect(data.has("active")).toBe(true);
    expect(browser.script).not.toHaveBeenCalled();
    browser.getSession.mockResolvedValue(null);
    await collector.alarm();
    expect(data.has("active")).toBe(false);
  });
  it("honors cancellation before opening a browser", async () => {
    const { collector, data, browser } = setup();
    await start(collector);
    await collector.fetch(
      new Request("https://collector/cancel", { method: "POST" }),
    );
    await collector.alarm();
    expect(browser.script).not.toHaveBeenCalled();
    expect(data.get("history")).toMatchObject([{ status: "CANCELLED" }]);
  });
  it("accounts for UTF-8 bytes in import chunks", () => {
    const rows = Array.from({ length: 40 }, () => ({
      text: "한".repeat(1000),
    }));
    const chunks = chunksByBytes(rows, 10000);
    expect(chunks.flat()).toEqual(rows);
    expect(
      chunks.every(
        (rows) =>
          new TextEncoder().encode(JSON.stringify({ rows })).length <= 10000,
      ),
    ).toBe(true);
    expect(canReserve(MONTHLY_BROWSER_LIMIT_MS, 0)).toBe(false);
  });
});
