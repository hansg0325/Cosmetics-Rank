import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const script = readFileSync("scripts/review_summary.js", "utf8");
async function collect(count: number, rating: number | null, wrongId = false) {
  const productId = "A000001002386";
  const row =
    "a:" +
    JSON.stringify({
      queryKey: ["goods", { goodsNumber: productId }],
      state: { data: { data: { goodsNumber: productId, options: [] } } },
    }) +
    "\n";
  const html = `<script>self.__next_f.push(${JSON.stringify([1, row])})</script>`;
  return new Promise<
    { product_id: string; review_count: number | null; rating: number | null }[]
  >((resolve) => {
    runInNewContext(script, {
      arguments: [[productId], resolve],
      AbortSignal,
      setTimeout: (callback: () => void) => callback(),
      fetch: async (url: string) =>
        url.includes("getGoodsDetail")
          ? new Response(html)
          : Response.json({
              data: {
                reviewInfoDto: {
                  goodsNo: wrongId ? "A000000000001" : productId,
                  reviewCnt: count,
                  reviewAvgScore: rating,
                },
              },
            }),
    });
  });
}
describe("실제 리뷰 요약", () => {
  it("5점 척도의 평점과 리뷰 수를 추출", async () => {
    expect(await collect(44987, 4.9)).toEqual([
      { product_id: "A000001002386", review_count: 44987, rating: 4.9 },
    ]);
  });
  it("리뷰가 0개이면 평점은 없음", async () => {
    expect(await collect(0, null)).toEqual([
      { product_id: "A000001002386", review_count: 0, rating: null },
    ]);
  });
  it("다른 상품의 정보나 잘못된 척도를 표시하지 않음", async () => {
    expect((await collect(100, 5.5))[0]).toMatchObject({
      review_count: null,
      rating: null,
    });
    expect((await collect(100, 4.5, true))[0]).toMatchObject({
      review_count: null,
      rating: null,
    });
  });
});
