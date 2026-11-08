import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { parseHTML } from "linkedom";
import fixture from "../fixtures/product_detail_rendered.json";

const script = readFileSync("scripts/product_details.js", "utf8");
const escape = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
function extract(
  summary = fixture.summary,
  tables = fixture.tables,
  id = fixture.product_id,
  scoped = true,
) {
  const { document } = parseHTML(
    `<html><body><div ${scoped ? 'class="GoodsDetailInfo_goods-info__test"' : ""}><h3>${escape(fixture.product_name)}</h3><div>${escape(summary)}</div></div>상품설명<div>평점 4.2 리뷰 999건</div><table>${tables.map((r) => `<tr><th>${escape(r.label)}</th><td>${escape(r.text)}</td></tr>`).join("")}</table></body></html>`,
  );
  return runInNewContext(`(function(){${script}}).apply(null, args)`, {
    document,
    location: {
      href: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${id}`,
    },
    URL,
    args: [fixture.product_id, fixture.product_name],
    fetch: () => {
      throw Error("No additional requests allowed");
    },
  });
}
describe("한 상세페이지에서 모든 항목 추출", () => {
  it("보관된 실제 렌더링 원문에서 제조업자·성분·리뷰·평점을 함께 읽음", () => {
    const result = extract();
    expect(result).toMatchObject({
      product_id: fixture.product_id,
      raw: fixture.tables[0].text,
      ingredients: fixture.tables[1].text,
      review_count: 44987,
      rating: 4.9,
      review_status: "FOUND",
      disclosure_checked: true,
    });
  });
  it("리뷰 0개와 미렌더링, 5점 범위 밖 수치를 구분", () => {
    expect(extract("리뷰 0건")).toMatchObject({
      review_count: 0,
      rating: null,
      review_status: "FOUND",
    });
    expect(extract("평점 5.5 리뷰 100건")).toMatchObject({
      review_count: null,
      rating: null,
      review_status: "INVALID_SUMMARY",
    });
    expect(extract("평점 로딩 중")).toMatchObject({
      review_count: null,
      rating: null,
      review_status: "NOT_RENDERED",
    });
  });
  it("고시가 없어도 리뷰는 보존하고 상세페이지 참조는 성분으로 추정하지 않음", () => {
    expect(extract(fixture.summary, [])).toMatchObject({
      raw: null,
      ingredients: null,
      review_count: 44987,
      rating: 4.9,
    });
    expect(
      extract(fixture.summary, [
        {
          label: "화장품법에 따라 기재해야 하는 모든 성분",
          text: "상세페이지 참조",
        },
      ]),
    ).toMatchObject({ ingredients: null, review_count: 44987 });
  });
  it("다른 상품과 추천 상품의 리뷰는 사용하지 않음", () => {
    expect(
      extract(fixture.summary, fixture.tables, "A000000000001"),
    ).toBeNull();
    expect(
      extract("리뷰 로딩 중", fixture.tables, fixture.product_id, false),
    ).toMatchObject({ review_count: null, rating: null });
    expect(
      extract(fixture.summary, fixture.tables, fixture.product_id, false),
    ).toMatchObject({ review_count: 44987, rating: 4.9 });
  });
});
