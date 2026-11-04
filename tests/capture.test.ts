import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { captureRanking } from "../src/client/capture";
import { parseBrowserCapture } from "../src/shared/browserCapture";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
const source = "https://www.oliveyoung.co.kr/store/main/getBestList.do";
function page(count = 100) {
  const cards = Array.from(
    { length: count },
    (_, i) =>
      `<li><div class="prd_info"><a class="prd_thumb"><span class="thumb_flag best">${String(i + 1).padStart(2, "0")}</span><img src="https://example.invalid/image.jpg"></a><div class="prd_name"><a href="/store/goods/getGoodsDetail.do?goodsNo=A${String(i + 1).padStart(12, "0")}&trackingCd=secret"><span class="tx_brand">브랜드 ${i + 1}</span><p class="tx_name">한글 &amp; 상품 ${i + 1}</p></a></div><p class="prd_price">999,999원</p></div></li>`,
  ).join("");
  return parseHTML(
    `<div id="Container"><ul><li class="on"><button title="선택됨">전체</button></li></ul><ul class="cate_prd_list">${cards}</ul></div>`,
  ).document as unknown as Document;
}
describe("실제 랭킹 브라우저 캡처 (DOM 형식 재현)", () => {
  it("생성된 북마크 도구가 외부 요청 없이 JSON 다운로드를 생성", async () => {
    const html = readFileSync("public/capture.html", "utf8");
    const install = html.match(/<script>([\s\S]*?)<\/script>/)![1];
    const anchor = { href: "" };
    runInNewContext(install, { document: { getElementById: () => anchor } });
    const doc = page();
    let saved: Blob | undefined;
    let filename = "";
    let clicked = false;
    const create = doc.createElement.bind(doc);
    doc.createElement = ((tag: string) => {
      if (tag !== "a") return create(tag);
      return {
        set href(_v: string) {
          void _v;
        },
        set download(v: string) {
          filename = v;
        },
        click() {
          clicked = true;
        },
      };
    }) as typeof doc.createElement;
    class DownloadURL extends URL {
      static createObjectURL(blob: Blob) {
        saved = blob;
        return "blob:test";
      }
      static revokeObjectURL() {}
    }
    runInNewContext(anchor.href.slice("javascript:".length), {
      document: doc,
      location: { href: source },
      URL: DownloadURL,
      Blob,
      Date,
      Intl,
      alert: (msg: string) => {
        throw Error(msg);
      },
    });
    expect(clicked).toBe(true);
    expect(filename).toMatch(/^oliveyoung-overall-\d{4}-\d{2}-\d{2}\.json$/);
    const exported = JSON.parse(await saved!.text());
    expect(exported.rows).toHaveLength(100);
    expect(() => parseBrowserCapture(exported)).not.toThrow();
  });
  it("전체100개, 날짜KST, 가격·이미지·추적항목 미포함", () => {
    const capture = captureRanking(page(), source, "2026-11-03T16:30:00Z");
    expect(capture.ranking_date).toBe("2026-11-04");
    expect(capture.rows).toHaveLength(100);
    expect(capture.rows[0]).toEqual({
      rank: 1,
      product_id: "A000000000001",
      brand_name: "브랜드 1",
      product_name: "한글 & 상품 1",
      product_url:
        "https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=A000000000001",
    });
    expect(JSON.stringify(capture)).not.toMatch(/999,999|image|price|tracking/);
    expect(parseBrowserCapture(capture).rows[0]).toMatchObject({
      list_price: null,
      sale_price: null,
      category_code: "overall",
    });
  });
  it.each([0, 99, 101])("%i행 불완전 목록 거부", (count) =>
    expect(() =>
      captureRanking(page(count), source, "2026-11-04T00:00:00Z"),
    ).toThrow("1~100"),
  );
  it("차단화면 및 카테고리 오선택 거부", () => {
    expect(() =>
      captureRanking(
        parseHTML("<h1>잠시만 기다려 주세요</h1>")
          .document as unknown as Document,
        source,
        "2026-11-04T00:00:00Z",
      ),
    ).toThrow("전체");
    const doc = page();
    doc.querySelector("button")!.textContent = "스킨케어";
    expect(() => captureRanking(doc, source, "2026-11-04T00:00:00Z")).toThrow(
      "전체",
    );
  });
  it("외부페이지, 잘못된상품 링크 거부", () => {
    expect(() =>
      captureRanking(
        page(),
        "https://evil.example/store/main/getBestList.do",
        "2026-11-04T00:00:00Z",
      ),
    ).toThrow("페이지");
    const doc = page();
    doc
      .querySelector(".prd_name a")!
      .setAttribute("href", "https://evil.example/?goodsNo=A000000000001");
    expect(() => captureRanking(doc, source, "2026-11-04T00:00:00Z")).toThrow(
      "식별자",
    );
  });
  it("중복 순위/중복 상품 거부", () => {
    const a = page();
    a.querySelectorAll(".thumb_flag")[1].textContent = "01";
    expect(() => captureRanking(a, source, "2026-11-04T00:00:00Z")).toThrow(
      "1~100",
    );
    const b = page();
    b.querySelectorAll(".prd_name a")[1].setAttribute(
      "href",
      "/store/goods/getGoodsDetail.do?goodsNo=A000000000001",
    );
    expect(() => captureRanking(b, source, "2026-11-04T00:00:00Z")).toThrow(
      "1~100",
    );
  });
  it("JSON 추가 필드와 날짜/ID변조 거부", () => {
    const capture = captureRanking(page(), source, "2026-11-04T00:00:00Z");
    expect(() =>
      parseBrowserCapture({ ...capture, ranking_date: "2026-11-03" }),
    ).toThrow("KST");
    capture.rows[0].product_url += "&tracking=x";
    expect(() => parseBrowserCapture(capture)).toThrow("원본 링크");
    const clean = captureRanking(page(), source, "2026-11-04T00:00:00Z");
    expect(() =>
      parseBrowserCapture({
        ...clean,
        rows: clean.rows.map((r) => ({ ...r, image_url: "secret" })),
      }),
    ).toThrow();
  });
  it("브라우저 세션 시각 보존", () => {
    const capture = captureRanking(page(), source, "2026-11-04T04:47:21.447Z");
    expect(parseBrowserCapture(capture).capture.collected_at).toBe(
      "2026-11-04T04:47:21.447Z",
    );
  });
});
