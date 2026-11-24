import { expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { Miniflare } from "miniflare";
vi.mock("../src/scheduler/browser", () => ({
  rankingScript: () => "",
  detailScript: () => "",
}));
import {
  CloudCollector,
  type CollectionRun,
  type CollectorEnv,
} from "../src/scheduler/collector";
import categories from "../src/shared/collectionCategories.json";
it("closes before importing all ten categories into real D1", async () => {
  const mf = new Miniflare({
    modules: true,
    script: "export default {fetch(){return new Response('ok')}}",
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
  });
  try {
    const db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const name of readdirSync("migrations")
      .filter((n) => n.endsWith(".sql"))
      .sort()) {
      const sql = readFileSync(`migrations/${name}`, "utf8").replace(
        /^\s*--.*$/gm,
        "",
      );
      for (const statement of (/(?:000[2468]|0010)/.test(name)
        ? sql.match(/CREATE TRIGGER[\s\S]*?\nEND;/g)
        : sql.match(/[^;]+;/g)) || [])
        await db.prepare(statement.trim()).run();
    }
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
      list: async ({ prefix, limit }: { prefix: string; limit: number }) =>
        new Map(
          [...data].filter(([key]) => key.startsWith(prefix)).slice(0, limit),
        ),
      setAlarm: async () => {},
      deleteAlarm: async () => {},
    };
    let closed = false;
    const browser = {
      script: vi.fn(),
      closeSession: vi.fn(async () => {
        closed = true;
        return { status: "closed" };
      }),
      getSession: async () => null,
    };
    const guardedDB = {
      prepare: (sql: string) => {
        expect(closed).toBe(true);
        return db.prepare(sql);
      },
      batch: (queries: D1PreparedStatement[]) => db.batch(queries),
    } as unknown as D1Database;
    const c = new CloudCollector(
      {
        storage,
        blockConcurrencyWhile: async (fn: () => Promise<unknown>) => fn(),
      } as unknown as DurableObjectState,
      { DB: guardedDB, BROWSER: browser } as unknown as CollectorEnv,
    );
    await c.fetch(
      new Request("https://collector/start", { method: "POST", body: "{}" }),
    );
    const run = data.get("active") as CollectionRun;
    run.phase = "details";
    run.sessionId = "test-session";
    run.rankingCount = 1000;
    for (const category of Object.keys(categories)) {
      const rows = Array.from({ length: 100 }, (_, index) => ({
        id: `TEST${index}`,
        rank: index + 1,
        name: `상품 ${index}`,
        brand: "검증",
        category: "02>메이크업",
      }));
      data.set(`rank:${run.id}:${category}`, rows);
      for (const row of rows)
        data.set(`detail:${run.id}:${row.id}`, {
          id: row.id,
          blocked: false,
          fields: {
            raw: "제조/판매",
            cosmetic_disclosure: true,
            ingredients: "정제수",
            review_count: 123,
            rating: 4.5,
            review_status: "FOUND",
            disclosure_checked: true,
          },
        });
    }
    await c.alarm();
    expect(closed).toBe(true);
    expect((data.get("active") as CollectionRun).phase).toBe("save");
    for (let i = 0; i < 10; i++) await c.alarm();
    expect(data.has("active")).toBe(false);
    expect(data.get("history")).toMatchObject([
      { status: "COMPLETE", savedCategories: 10, closeStatus: "CLOSED" },
    ]);
    expect(
      await db.prepare("SELECT count(*) AS n FROM ranking_entries").first("n"),
    ).toBe(1000);
    expect(
      await db
        .prepare(
          "SELECT count(*) AS n FROM ingestion_runs WHERE status='COMPLETE'",
        )
        .first("n"),
    ).toBe(10);
    expect(browser.script).not.toHaveBeenCalled();
  } finally {
    await mf.dispose();
  }
}, 180000);
