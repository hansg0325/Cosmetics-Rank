import { defaultKeywordRules } from "../src/shared/keywordRules";
import { describe, it, expect, vi, afterEach } from "vitest";
import app from "../src/worker/index";
import { collectRankings } from "../src/client/collector";
import {
  collectionCategories,
  collectionCategorySchema,
  type CollectionCategory,
} from "../src/shared/browserCapture";
const id = "11111111-1111-4111-8111-111111111111";
const env = {
  LOCAL_DEV_TOKEN: "test-token",
  ACCESS_TEAM: "",
  ACCESS_AUD: "",
  ALLOWED_EMAIL: "",
  DB: { prepare: () => ({ first: async () => null }) } as unknown as D1Database,
  ASSETS: {} as Fetcher,
};
function req(path: string, body?: unknown, host = "http://localhost") {
  return app.request(
    host + path,
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "x-local-token": "test-token",
        origin: host,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    },
    env,
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe("Hono 로컬 수집 서비스 프록시", () => {
  it("전체와 9개 카테고리의 서버 요청을 지원", async () => {
    const fetcher = vi.fn(async () => Response.json({ id, status: "RUNNING" }));
    vi.stubGlobal("fetch", fetcher);
    const codes = Object.keys(collectionCategories) as CollectionCategory[];
    expect(codes).toHaveLength(10);
    for (const category_code of codes) {
      expect(collectionCategorySchema.parse(category_code)).toBe(category_code);
      expect((await req("/api/admin/collector/jobs", { category_code })).status).toBe(
        202,
      );
      expect(fetcher).toHaveBeenLastCalledWith(
        "http://127.0.0.1:8790/jobs",
        expect.objectContaining({
          body: JSON.stringify({
            category_code,
            keyword_rules: defaultKeywordRules,
          }),
        }),
      );
    }
  });
  it("스킨케어 요청을 전달하고 미지원 카테고리는 거부", async () => {
    const fetcher = vi.fn(async () => Response.json({ id, status: "RUNNING" }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await req("/api/admin/collector/jobs", { category_code: "skincare" })).status,
    ).toBe(202);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8790/jobs",
      expect.objectContaining({
        body: JSON.stringify({
          category_code: "skincare",
          keyword_rules: defaultKeywordRules,
        }),
      }),
    );
    expect(
      (await req("/api/admin/collector/jobs", { category_code: "unknown" })).status,
    ).toBe(400);
  });
  it("인증을 거쳐 고정 loopback 주소만 호출", async () => {
    const fetcher = vi.fn(async () => Response.json({ id, status: "RUNNING" }));
    vi.stubGlobal("fetch", fetcher);
    expect((await req("/api/admin/collector/jobs", {})).status).toBe(202);
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:8790/jobs",
      expect.objectContaining({
        method: "POST",
        redirect: "manual",
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });
  it("로컬에서는 토큰 없이 실행하고 다른 Origin·배포 주소는 거부", async () => {
    const fetcher = vi.fn(async () => Response.json({ id, status: "RUNNING" }));
    vi.stubGlobal("fetch", fetcher);
    expect(
      (
        await app.request(
          "http://localhost/api/admin/collector/jobs",
          { method: "POST", body: "{}" },
          env,
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await app.request(
          "http://localhost/api/admin/collector/jobs",
          {
            method: "POST",
            headers: { origin: "http://localhost", "content-type": "application/json" },
            body: "{}",
          },
          env,
        )
      ).status,
    ).toBe(202);
    // The local-only helper cannot be called through a deployed host.
    expect(
      (await req("/api/admin/collector/jobs", {}, "https://example.workers.dev"))
        .status,
    ).toBe(403);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("임의 URL과 잘못된 작업 ID 거부", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    expect(
      (await req("/api/admin/collector/jobs", { url: "https://evil.example" }))
        .status,
    ).toBe(400);
    expect((await req("/api/admin/collector/jobs/not-a-uuid")).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("서비스 미실행 시 안전한 안내 반환", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Error("private stack");
      }),
    );
    const r = await req("/api/admin/collector/jobs", {});
    expect(r.status).toBe(503);
    expect(await r.json()).toMatchObject({
      error: "COLLECTOR_UNAVAILABLE",
      message: expect.stringContaining("start-local.sh"),
    });
  });
  it("진행·완료 응답과 만료 상태 전달", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id, status: "RUNNING" })),
    );
    expect(await (await req("/api/admin/collector/jobs/" + id)).json()).toMatchObject(
      { id, status: "RUNNING" },
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ error: "NOT_FOUND" }, { status: 404 })),
    );
    expect((await req("/api/admin/collector/jobs/" + id)).status).toBe(404);
  });
});
describe("버튼 수집 진행 상태 처리", () => {
  it("실패한 작업은 업로드용 데이터를 반환하지 않음", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id, status: "RUNNING" }))
        .mockResolvedValueOnce(
          Response.json({ id, status: "FAILED", message: "접속 확인 필요" }),
        ),
    );
    const pending = expect(collectRankings(vi.fn())).rejects.toThrow(
      "접속 확인 필요",
    );
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });
  it("완료여도 불완전한 100행 데이터는 거부", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id, status: "RUNNING" }))
        .mockResolvedValueOnce(
          Response.json({ id, status: "COMPLETE", capture: { rows: [] } }),
        ),
    );
    const pending = expect(collectRankings(vi.fn())).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(1000);
    await pending;
  });
  it("지속되는 RUNNING은 3960초 후 종료", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ id, status: "RUNNING" })),
    );
    const pending = expect(collectRankings(vi.fn())).rejects.toThrow(
      "대기 시간이 초과",
    );
    await vi.advanceTimersByTimeAsync(3962000);
    await pending;
  });
  it("COMPLETE의 유효한 데이터만 원래 KST 날짜와 함께 반환", async () => {
    const capture = {
      format: "cosmetics-rank-browser-v1",
      source_url: "https://www.oliveyoung.co.kr/store/main/getBestList.do",
      collected_at: "2026-11-04T00:00:00Z",
      ranking_date: "2026-11-04",
      category_code: "overall",
      rows: Array.from({ length: 100 }, (_, i) => {
        const product_id = "A" + String(i + 1).padStart(12, "0");
        return {
          rank: i + 1,
          product_id,
          brand_name: "테스트",
          product_name: "상품 " + i,
          product_url:
            "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=" +
            product_id,
        };
      }),
    };
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ id, status: "RUNNING" }))
        .mockResolvedValueOnce(
          Response.json({
            id,
            status: "COMPLETE",
            capture,
            coverage: {
              total: 100,
              manufacturers: 75,
              sellers: 75,
              ingredients: 60,
              reviews: 90,
              ratings: 89,
            },
          }),
        ),
    );
    const promise = collectRankings(vi.fn());
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(result.rows).toHaveLength(100);
    expect(result.coverage).toMatchObject({
      total: 100,
      reviews: 90,
      ratings: 89,
      ingredients: 60,
    });
    expect(result.rows[0].sale_price).toBeNull();
    const skincare = {
      ...capture,
      category_code: "skincare",
      source_url: collectionCategories.skincare.source_url,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ id, status: "COMPLETE", capture: skincare }),
      ),
    );
    const skinResult = await collectRankings(vi.fn(), "skincare");
    expect(
      skinResult.rows.every((row) => row.category_code === "skincare"),
    ).toBe(true);
    await expect(collectRankings(vi.fn(), "overall")).rejects.toThrow(
      "카테고리",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          id,
          status: "COMPLETE",
          capture: { ...skincare, source_url: capture.source_url },
        }),
      ),
    );
    await expect(collectRankings(vi.fn(), "skincare")).rejects.toThrow("출처");
  });
});
