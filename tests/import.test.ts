import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { Miniflare } from "miniflare";
import { Workbook } from "exceljs";
import app from "../src/worker/index";
import { parseCsv, parseXlsx } from "../src/client/importer";
import { validateRows, safeSpreadsheetText } from "../src/shared/schemas";
import type { RankingRow } from "../src/shared/schemas";
const rows = parseCsv(
  readFileSync("fixtures/sample_rankings_2days.csv", "utf8"),
);
describe("파일 검증", () => {
  it("샘플 2일×100행", () => {
    expect(rows).toHaveLength(200);
    expect(new Set(rows.map((r) => r.ranking_date)).size).toBe(2);
  });
  it.each([
    "missing",
    "rank",
    "product",
    "range",
    "date",
    "id",
    "url",
  ] as const)("%s 거부", (kind) => {
    const rs = structuredClone(rows.slice(0, 100));
    if (kind === "missing") rs.pop();
    if (kind === "rank") rs[1].rank = 1;
    if (kind === "product") rs[1].product_id = rs[0].product_id;
    if (kind === "range") rs[0].rank = 101;
    if (kind === "date") rs[0].ranking_date = "2026-02-30";
    if (kind === "id") rs[0].product_id = "";
    if (kind === "url") rs[0].product_url = "javascript:alert(1)";
    expect(() => validateRows(rs)).toThrow();
  });
  it("CSV 따옴표/한글/쉼표 보존, 가격 무시", () => {
    const copy = structuredClone(rows.slice(0, 100));
    copy[0].product_name = '한글, "상품"';
    copy[0].sale_price = 0;
    copy[0].list_price = null;
    const csv =
      Object.keys(copy[0]).join(",") +
      "\n" +
      copy
        .map((r) =>
          Object.values(r)
            .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
            .join(","),
        )
        .join("\n");
    expect(parseCsv(csv)[0]).toEqual({
      ...copy[0],
      sale_price: null,
      list_price: null,
    });
  });
  it.each(["=cmd", "+SUM(1,2)", "-1", "@X", "  =1", "\t=1"])(
    "수식 중화 %s",
    (s) => expect(safeSpreadsheetText(s)).toBe("'" + s),
  );
  it("XLSX 한글 열 매핑/URL, 가격 무시", async () => {
    const wb = new Workbook();
    const s = wb.addWorksheet("입력");
    s.addRow([
      "날짜",
      "카테고리",
      "순위",
      "상품 ID",
      "브랜드",
      "상품명",
      "URL",
      "정가",
      "판매가",
    ]);
    for (const r of rows.slice(0, 100))
      s.addRow([
        r.ranking_date,
        r.category_code,
        r.rank,
        r.product_id,
        "한국 브랜드",
        "한글 상품",
        "https://example.com/상품",
        null,
        0,
      ]);
    const result = await parseXlsx(
      (await wb.xlsx.writeBuffer()) as ArrayBuffer,
    );
    expect(result[0]).toMatchObject({
      brand_name: "한국 브랜드",
      product_name: "한글 상품",
      sale_price: null,
      list_price: null,
      product_url: "https://example.com/상품",
    });
  });
  it("XLSX 수식 거부", async () => {
    const w = new Workbook(),
      s = w.addWorksheet("x");
    s.addRow(["product_name"]);
    s.addRow([{ formula: "1+1", result: 2 }]);
    await expect(
      parseXlsx((await w.xlsx.writeBuffer()) as ArrayBuffer),
    ).rejects.toThrow("수식");
  });
});
let mf: Miniflare;
let db: D1Database;
const env = () => ({
  DB: db,
  ASSETS: { fetch: async () => new Response("static") } as unknown as Fetcher,
  LOCAL_DEV_TOKEN: "test-token",
  ACCESS_TEAM: "",
  ACCESS_AUD: "",
  ALLOWED_EMAIL: "",
});
async function req(
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  return app.request(
    "http://localhost" + path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-local-token": "test-token",
        origin: "http://localhost",
        "Content-Type": "application/json",
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env(),
  );
}
async function start(date: string, ref: string, replace = false) {
  const r = await req("/api/imports", {
    ranking_date: date,
    category_code: "skincare",
    collected_at: "2026-11-04T00:00:00Z",
    source_ref: ref,
    replace,
  });
  expect(r.status).toBe(201);
  return (await r.json()) as { id: string };
}
async function chunks(id: string, data: RankingRow[]) {
  for (let i = 0; i < data.length; i += 20)
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: data.slice(i, i + 20) }))
        .status,
    ).toBe(200);
}
describe.sequential("실제 로컬 D1 (Miniflare)", () => {
  beforeAll(async () => {
    mf = new Miniflare({
      modules: true,
      script: 'export default {fetch(){return new Response("ok")}}',
      compatibilityDate: "2026-07-01",
      d1Databases: ["DB"],
    });
    db = (await mf.getD1Database("DB")) as unknown as D1Database;
    for (const path of [
      "migrations/0001_initial.sql",
      "migrations/0002_import_guards.sql",
      "migrations/0003_product_category.sql",
      "migrations/0004_category_replay_guard.sql",
    ]) {
      const sql = readFileSync(path, "utf8").replace(/^\s*--.*$/gm, "");
      for (const statement of (/000[24]/.test(path)
        ? sql.match(/CREATE TRIGGER[\s\S]*?\nEND;/g)
        : sql.match(/[^;]+;/g)) || []) {
        const clean = statement.replace(/^\s*--.*$/gm, "").trim();
        if (clean) await db.prepare(clean).run();
      }
    }
  }, 30000);
  afterAll(async () => {
    await mf?.dispose();
  });
  it("22개 카테고리 seed", async () =>
    expect(
      ((await (await req("/api/categories")).json()) as unknown[]).length,
    ).toBe(22));
  it("UI/API 비인증 차단 및 위조 JWT 거부", async () => {
    for (const p of ["/", "/api/categories"]) {
      expect(
        (await app.request("http://localhost" + p, {}, env())).status,
      ).toBe(401);
      expect(
        (
          await app.request(
            "https://deployed.workers.dev" + p,
            {
              headers: {
                "x-local-token": "test-token",
                "cf-access-jwt-assertion": "fake",
              },
            },
            env(),
          )
        ).status,
      ).toBe(401);
    }
  });
  it("다른 Origin 거부", async () =>
    expect(
      (await req("/api/imports", {}, { origin: "https://evil.example" }))
        .status,
    ).toBe(403));
  it("부분 스냅샷 비공개, 누락 순위 완료 거부, 재전송 멱등성, 2일 200행 완료", async () => {
    for (const date of ["2026-11-03", "2026-11-04"]) {
      const data = rows.filter((r) => r.ranking_date === date);
      const { id } = await start(date, date);
      await chunks(id, data.slice(0, 20));
      await chunks(id, data.slice(0, 20));
      expect(
        (
          await db
            .prepare(
              "SELECT COUNT(*) n FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE s.ingestion_run_id=?",
            )
            .bind(id)
            .first<{ n: number }>()
        )?.n,
      ).toBe(20);
      expect(
        await (
          await req(`/api/rankings?date=${date}&category=skincare`)
        ).json(),
      ).toEqual([]);
      expect((await req(`/api/imports/${id}/complete`, {})).status).toBe(422);
      await chunks(id, data.slice(20));
      expect((await req(`/api/imports/${id}/complete`, {})).status).toBe(200);
      expect((await req(`/api/imports/${id}/complete`, {})).status).toBe(200);
      expect(
        (
          (await (
            await req(`/api/rankings?date=${date}&category=skincare`)
          ).json()) as unknown[]
        ).length,
      ).toBe(100);
    }
  });
  it("동일 재업로드 멱등, 변경본 확인 요구", async () => {
    const base = {
      ranking_date: "2026-11-04",
      category_code: "skincare",
      collected_at: "2026-11-04T00:00:00Z",
      source_ref: "2026-11-04",
    };
    expect(
      (
        (await (await req("/api/imports", base)).json()) as {
          already_complete: boolean;
        }
      ).already_complete,
    ).toBe(true);
    expect(
      (
        (await (
          await req("/api/imports", { ...base, replace: true })
        ).json()) as { already_complete: boolean }
      ).already_complete,
    ).toBe(true);
    expect(
      (await req("/api/imports", { ...base, source_ref: "changed" })).status,
    ).toBe(409);
  });
  it("잘못된 청크/동일 순위 변경/동일 상품 거부, 트랜잭션 롤백", async () => {
    const { id } = await start("2026-11-04", "conflict", true);
    await chunks(id, rows.slice(100, 120));
    const copy = structuredClone(rows[100]);
    copy.product_name = "변경";
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: [copy] })).status,
    ).toBe(409);
    copy.rank = 21;
    copy.product_id = rows[100].product_id;
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: [copy] })).status,
    ).toBe(409);
    copy.ranking_date = "bad";
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: [copy] })).status,
    ).toBe(400);
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: rows.slice(100, 121) }))
        .status,
    ).toBe(400);
    expect(
      (await req(`/api/imports/${id}/complete`, { replace: true })).status,
    ).toBe(422);
    expect(
      (
        (await (
          await req("/api/rankings?date=2026-11-04&category=skincare")
        ).json()) as unknown[]
      ).length,
    ).toBe(100);
    expect(
      (await req(`/api/imports/${id}/cancel`, { failed: true })).status,
    ).toBe(200);
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: rows.slice(100, 101) }))
        .status,
    ).toBe(409);
  });
  it("취소와 실패 상태 기록", async () => {
    const { id } = await start("2026-11-02", "cancel");
    await req(`/api/imports/${id}/cancel`, {});
    expect(
      (
        await db
          .prepare("SELECT status FROM ingestion_runs WHERE id=?")
          .bind(id)
          .first<{ status: string }>()
      )?.status,
    ).toBe("CANCELLED");
    expect((await req(`/api/imports/${id}/complete`, {})).status).toBe(409);
  });
  it("명시적 교체는 이전 버전 보존 후 원자 활성화", async () => {
    const { id } = await start("2026-11-04", "replacement", true);
    const data = structuredClone(rows.slice(100));
    data[0].product_name = "수정된 상품";
    await chunks(id, data);
    expect(
      (await req(`/api/imports/${id}/complete`, { replace: true })).status,
    ).toBe(200);
    const result = (await (
      await req("/api/rankings?date=2026-11-04&category=skincare")
    ).json()) as { product_name_at_capture: string }[];
    expect(result[0].product_name_at_capture).toBe("수정된 상품");
    expect(
      (
        await db
          .prepare(
            "SELECT COUNT(*) n FROM snapshots WHERE ranking_date='2026-11-04' AND status='COMPLETE'",
          )
          .first<{ n: number }>()
      )?.n,
    ).toBe(2);
  });
  it("동시 완료/취소 후 실행과 스냅샷 상태 일치", async () => {
    const { id } = await start("2026-11-01", "race");
    const target = await db
      .prepare("SELECT id FROM snapshots WHERE ingestion_run_id=?")
      .bind(id)
      .first<{ id: number }>();
    await db
      .prepare(
        "INSERT INTO ranking_entries SELECT ?,e.rank,e.product_id,e.brand_name_at_capture,e.product_name_at_capture,e.list_price,e.sale_price,e.product_url_at_capture,e.product_category_at_capture FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE s.ranking_date='2026-11-03' AND s.is_active=1",
      )
      .bind(target!.id)
      .run();
    const responses = await Promise.all([
      req(`/api/imports/${id}/complete`, {}),
      req(`/api/imports/${id}/cancel`, {}),
    ]);
    expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
    const state = await db
      .prepare(
        "SELECT s.status snapshot_status,s.is_active,r.status run_status FROM snapshots s JOIN ingestion_runs r ON r.id=s.ingestion_run_id WHERE r.id=?",
      )
      .bind(id)
      .first<{
        snapshot_status: string;
        is_active: number;
        run_status: string;
      }>();
    if (state!.run_status === "COMPLETE")
      expect(state).toMatchObject({
        snapshot_status: "COMPLETE",
        is_active: 1,
      });
    else
      expect(state).toMatchObject({
        snapshot_status: "FAILED",
        is_active: 0,
        run_status: "CANCELLED",
      });
  });
  it("본문 64KiB 제한 및 미완성 직접 완료 DB 차단", async () => {
    expect(
      (await req("/api/imports", { padding: "x".repeat(66000) })).status,
    ).toBe(413);
    const { id } = await start("2026-10-31", "db-guard");
    await expect(
      db
        .prepare(
          "UPDATE snapshots SET status='COMPLETE',is_active=1 WHERE ingestion_run_id=?",
        )
        .bind(id)
        .run(),
    ).rejects.toThrow("incomplete ranks");
    await req(`/api/imports/${id}/cancel`, {});
  });
  it("상품 대분류 저장 및 변경 재전송 차단", async () => {
    const { id } = await start("2026-10-25", "category-test");
    const row = {
      ...rows[0],
      ranking_date: "2026-10-25",
      product_category: "스킨케어",
    };
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: [row] })).status,
    ).toBe(200);
    expect(
      (await req(`/api/imports/${id}/chunks`, { rows: [row] })).status,
    ).toBe(200);
    expect(
      (
        await req(`/api/imports/${id}/chunks`, {
          rows: [{ ...row, product_category: "선케어" }],
        })
      ).status,
    ).toBe(409);
    const saved = await db
      .prepare(
        "SELECT e.product_category_at_capture category FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE s.ingestion_run_id=?",
      )
      .bind(id)
      .first<{ category: string }>();
    expect(saved?.category).toBe("스킨케어");
    await req(`/api/imports/${id}/cancel`, {});
  });
});
