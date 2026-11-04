import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { Miniflare } from "miniflare";
import { readFileSync } from "node:fs";
import app from "../src/worker/index";
import { parseCsv } from "../src/client/importer";
import type { RankingRow } from "../src/shared/schemas";
import type {
  Comparison,
  ProductHistory,
  DashboardData,
  ProductSummary,
} from "../src/shared/analytics";
let mf: Miniflare, db: D1Database;
let counter = 0;
const versions = new Map<string, number>();
const source = parseCsv(
  readFileSync("fixtures/sample_rankings_2days.csv", "utf8"),
);
const first = source.slice(0, 100),
  second = source.slice(100);
async function snapshot(
  date: string,
  data: RankingRow[],
  status = "COMPLETE",
  active = true,
) {
  const number = ++counter,
    run = crypto.randomUUID(),
    version = (versions.get(date) || 0) + 1;
  versions.set(date, version);
  const batch: D1PreparedStatement[] = [
    db
      .prepare(
        "INSERT INTO ingestion_runs(id,trigger_type,status,started_at) VALUES(?,'FIXTURE','RUNNING',?)",
      )
      .bind(run, date + "T00:00:00Z"),
    db
      .prepare(
        "INSERT INTO snapshots(id,ranking_date,category_code,version,ingestion_run_id,source_type,collected_at) VALUES(?,?,'skincare',?,?,'FIXTURE',?)",
      )
      .bind(number, date, version, run, date + "T00:00:00Z"),
  ];
  for (let i = 0; i < data.length; i += 25) {
    const chunk = data.slice(i, i + 25);
    batch.push(
      db
        .prepare(
          "INSERT INTO products(product_id,brand_name,product_name,product_url) VALUES " +
            chunk.map(() => "(?,?,?,?)").join(",") +
            " ON CONFLICT(product_id) DO UPDATE SET product_name=excluded.product_name,brand_name=excluded.brand_name",
        )
        .bind(
          ...chunk.flatMap((r) => [
            r.product_id,
            r.brand_name,
            r.product_name,
            r.product_url,
          ]),
        ),
    );
  }
  for (let i = 0; i < data.length; i += 16) {
    const chunk = data.slice(i, i + 16);
    batch.push(
      db
        .prepare(
          "INSERT INTO ranking_entries(snapshot_id,rank,product_id,brand_name_at_capture,product_name_at_capture,product_url_at_capture) VALUES " +
            chunk.map(() => "(?,?,?,?,?,?)").join(","),
        )
        .bind(
          ...chunk.flatMap((r) => [
            number,
            r.rank,
            r.product_id,
            r.brand_name,
            r.product_name,
            r.product_url,
          ]),
        ),
    );
  }
  if (status !== "IMPORTING") {
    if (active && status === "COMPLETE")
      batch.push(
        db
          .prepare(
            "UPDATE snapshots SET is_active=0 WHERE ranking_date=? AND category_code='skincare'",
          )
          .bind(date),
      );
    batch.push(
      db
        .prepare(
          "UPDATE snapshots SET status=?,is_active=?,entry_count=100 WHERE id=?",
        )
        .bind(status, status === "COMPLETE" && active ? 1 : 0, number),
      db
        .prepare("UPDATE ingestion_runs SET status=? WHERE id=?")
        .bind(status, run),
    );
  }
  await db.batch(batch);
  return number;
}
async function get<T>(path: string) {
  const r = await request(path);
  expect(r.status).toBe(200);
  return (await r.json()) as T;
}
function request(path: string) {
  return app.request(
    "http://localhost/api/" + path,
    { headers: { "x-local-token": "test-token" } },
    {
      DB: db,
      ASSETS: {} as Fetcher,
      LOCAL_DEV_TOKEN: "test-token",
      ACCESS_TEAM: "",
      ACCESS_AUD: "",
      ALLOWED_EMAIL: "",
    },
  );
}
describe("Phase 2 실제 D1 조회·비교·이력", () => {
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-07-01",
      d1Databases: ["DB"],
    });
    db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const file of [
      "migrations/0001_initial.sql",
      "migrations/0002_import_guards.sql",
      "migrations/0003_product_category.sql",
      "migrations/0004_category_replay_guard.sql",
    ]) {
      const sql = readFileSync(file, "utf8").replace(/^\s*--.*$/gm, "");
      for (const statement of (/000[24]/.test(file)
        ? sql.match(/CREATE TRIGGER[\s\S]*?\nEND;/g)
        : sql.match(/[^;]+;/g)) || [])
        await db.prepare(statement.trim()).run();
    }
    await snapshot("2026-11-03", first);
    await snapshot("2026-11-04", second);
    await snapshot("2026-11-05", second, "FAILED", false);
    await snapshot(
      "2026-11-06",
      second.map((r) => ({ ...r, brand_name: "구버전전용" })),
      "COMPLETE",
      false,
    );
    const moved = structuredClone(second);
    [moved[0], moved[99]] = [moved[99], moved[0]];
    moved.forEach((r, i) => {
      r.rank = i + 1;
      if (r.product_id === "DEMO-P010") {
        r.product_name = "PDRN 100% 히알루론산 세럼";
        r.brand_name = "새브랜드";
      }
    });
    await snapshot("2026-11-06", moved);
    const hidden = second.map((r) => ({
      ...r,
      product_name: "유출금지",
      brand_name: "유출금지",
    }));
    hidden[0].product_id = "PRIVATE-ONLY";
    await snapshot("2026-11-07", hidden, "IMPORTING", false);
  }, 30000);
  afterAll(async () => {
    await mf?.dispose();
  });
  it("첫 수집은 NEW가 아닌 비교 없음", async () => {
    const d = await get<Comparison>(
      "changes?date=2026-11-03&category=skincare",
    );
    expect(d.compared_to).toBeNull();
    expect(d.counts).toMatchObject({ UNCOMPARED: 100, NEW: 0, EXIT: 0 });
  });
  it("제공 이틀 샘플 상승·신규·이탈 계산", async () => {
    const d = await get<Comparison>(
      "changes?date=2026-11-04&category=skincare",
    );
    expect(d.compared_to).toBe("2026-11-03");
    expect(d.counts).toMatchObject({ UP: 91, NEW: 9, EXIT: 9, DOWN: 0 });
    expect(d.items.find((r) => r.product_id === "DEMO-P010")).toMatchObject({
      rank: 1,
      previous_rank: 10,
      rank_change: 9,
      movement: "UP",
    });
    expect(d.items.find((r) => r.product_id === "DEMO-P001")).toMatchObject({
      rank: null,
      previous_rank: 1,
      movement: "EXIT",
    });
  });
  it("누락/실패일과 당일 구버전을 건너뛰고 직전 성공일 비교", async () => {
    const d = await get<Comparison>(
      "changes?date=2026-11-06&category=skincare",
    );
    expect(d.compared_to).toBe("2026-11-04");
    expect(d.missing_days).toBe(1);
    expect(d.counts).toMatchObject({
      UP: 1,
      DOWN: 1,
      SAME: 98,
      NEW: 0,
      EXIT: 0,
    });
    expect(d.items.find((r) => r.product_id === "DEMO-P010")).toMatchObject({
      previous_rank: 1,
      rank: 100,
      rank_change: -99,
      movement: "DOWN",
    });
  });
  it("미수집/IMPORTING 날짜를 100개 EXIT로 오인하지 않음", async () => {
    const d = await get<Comparison>(
      "changes?date=2026-11-07&category=skincare",
    );
    expect(d.has_snapshot).toBe(false);
    expect(d.items).toEqual([]);
    expect(d.counts.EXIT).toBe(0);
    expect(await get("rankings?date=2026-11-05&category=skincare")).toEqual([]);
  });
  it("날짜는 COMPLETE 활성 버전만 고유하게 제공", async () => {
    expect(await get("dates?category=skincare")).toEqual({
      dates: ["2026-11-06", "2026-11-04", "2026-11-03"],
      next_cursor: null,
    });
    expect(await get("dates?category=skincare&before=2026-11-04")).toEqual({
      dates: ["2026-11-03"],
      next_cursor: null,
    });
  });
  it("랭킹 검색은 상품명·브랜드와 정확한 기호 지원", async () => {
    expect(
      (
        await get<unknown[]>(
          "rankings?date=2026-11-06&category=skincare&query=pdrn",
        )
      ).length,
    ).toBe(1);
    expect(
      (
        await get<unknown[]>(
          "rankings?date=2026-11-06&category=skincare&query=" +
            encodeURIComponent("새브랜드"),
        )
      ).length,
    ).toBe(1);
  });
  it("상품 검색에 미완성 상품/구버전/미완성 제품 테이블 명칭 노출 안함", async () => {
    for (const q of ["유출금지", "구버전전용"])
      expect(
        (
          await get<{ items: unknown[] }>(
            "products?query=" + encodeURIComponent(q),
          )
        ).items,
      ).toEqual([]);
    const d = await get<{ items: ProductSummary[] }>("products?query=pdrn");
    expect(d.items).toHaveLength(1);
    expect(d.items[0]).toMatchObject({
      product_id: "DEMO-P010",
      product_name: "PDRN 100% 히알루론산 세럼",
      brand_name: "새브랜드",
    });
    expect(
      (await get<{ items: unknown[] }>("products?query=%25")).items,
    ).toHaveLength(1);
  });
  it("상품 검색 cursor 페이지 중복 없이 크기 제한", async () => {
    const a = await get<{ items: ProductSummary[]; next_cursor: string }>(
      "products?limit=20",
    );
    const b = await get<{ items: ProductSummary[] }>(
      "products?limit=20&cursor=" + a.next_cursor,
    );
    expect(a.items).toHaveLength(20);
    expect(b.items).toHaveLength(20);
    expect(
      new Set([...a.items, ...b.items].map((r) => r.product_id)).size,
    ).toBe(40);
    expect((await request("products?limit=101")).status).toBe(400);
  });
  it("상품 이력에서 결측일과 100위권 밖 구분", async () => {
    const d = await get<ProductHistory>(
      "products/DEMO-P010/history?category=skincare&from=2026-11-03&to=2026-11-06",
    );
    expect(d.points.map((p) => p.rank)).toEqual([10, 1, null, 100]);
    expect(d.points[2].state).toBe("MISSING");
    expect(d.summary).toEqual({
      first_entry_date: "2026-11-03",
      best_rank: 1,
      last_record_date: "2026-11-06",
    });
    const exit = await get<ProductHistory>(
      "products/DEMO-P001/history?category=skincare&from=2026-11-03&to=2026-11-06",
    );
    expect(exit.points[1]).toMatchObject({
      rank: null,
      state: "OUTSIDE_TOP100",
    });
    expect(exit.points[2].state).toBe("MISSING");
  });
  it("미완성 상품 이력 비공개, 날짜·범위 입력 검증", async () => {
    expect(
      (
        await request(
          "products/PRIVATE-ONLY/history?category=skincare&from=2026-11-03&to=2026-11-06",
        )
      ).status,
    ).toBe(404);
    for (const range of [
      "from=2026-11-06&to=2026-11-03",
      "from=2026-01-01&to=2026-11-04",
      "from=2026-02-30&to=2026-11-04",
    ])
      expect(
        (await request("products/DEMO-P010/history?category=skincare&" + range))
          .status,
      ).toBe(400);
    expect(
      (await request("changes?date=2026-02-30&category=skincare")).status,
    ).toBe(400);
  });
  it("대시보드 최신일·상승 TOP·활성 및 보존 버전·7일 실행 상태", async () => {
    const d = await get<DashboardData>(
      "dashboard?category=skincare&asof=2026-11-06",
    );
    expect(d.latest_date).toBe("2026-11-06");
    expect(d.active_snapshots).toBe(3);
    expect(d.stored_versions).toBe(4);
    expect(d.top).toHaveLength(10);
    expect(d.rising[0]).toMatchObject({
      product_id: "DEMO-P109",
      rank_change: 99,
    });
    expect(d.days).toHaveLength(7);
    expect(d.days.find((r) => r.date === "2026-11-05")?.status).toBe("FAILED");
    expect(d.days.find((r) => r.date === "2026-11-06")?.complete).toBe(2);
  });
  it("데이터 없는 카테고리의 대시보드", async () => {
    const d = await get<DashboardData>(
      "dashboard?category=overall&asof=2026-11-06",
    );
    expect(d.latest_date).toBeNull();
    expect(d.top).toEqual([]);
    expect(d.rising).toEqual([]);
  });
});
