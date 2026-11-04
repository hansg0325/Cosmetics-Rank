/** Reads only the already-open ranking DOM. No fetch, images, prices or timers. */
export function captureRanking(doc: Document, pageUrl: string, now: string) {
  const page = new URL(pageUrl);
  if (
    page.origin !== "https://www.oliveyoung.co.kr" ||
    page.pathname !== "/store/main/getBestList.do"
  )
    throw new Error("올리브영 전체 랭킹 페이지에서 실행하세요.");
  const selected = Array.from(
    doc.querySelectorAll("#Container li.on > button"),
  ).find((button) => button.getAttribute("title") === "선택됨");
  if (selected?.textContent?.trim() !== "전체")
    throw new Error("카테고리에서 ‘전체’를 선택한 뒤 실행하세요.");
  const rows = Array.from(
    doc.querySelectorAll("#Container .cate_prd_list .prd_info"),
  )
    .map((card) => {
      const rankText =
        card.querySelector(".thumb_flag.best")?.textContent?.trim() || "";
      const href = card.querySelector(".prd_name a")?.getAttribute("href");
      if (!/^\d{1,3}$/.test(rankText) || !href)
        throw new Error("랭킹 페이지 구조를 확인할 수 없습니다.");
      const link = new URL(href, page.origin);
      const product_id = link.searchParams.get("goodsNo") || "";
      const brand_name =
        card.querySelector(".tx_brand")?.textContent?.trim() || "";
      const product_name =
        card.querySelector(".tx_name")?.textContent?.trim() || "";
      if (
        link.origin !== page.origin ||
        link.pathname !== "/store/goods/getGoodsDetail.do" ||
        !/^A\d{12}$/.test(product_id) ||
        !brand_name ||
        !product_name
      )
        throw new Error("상품 식별자 또는 상품명이 올바르지 않습니다.");
      return {
        rank: Number(rankText),
        product_id,
        brand_name,
        product_name,
        product_url:
          page.origin +
          "/store/goods/getGoodsDetail.do?goodsNo=" +
          encodeURIComponent(product_id),
      };
    })
    .sort((a, b) => a.rank - b.rank);
  if (
    rows.length !== 100 ||
    rows.some((r, i) => r.rank !== i + 1) ||
    new Set(rows.map((r) => r.product_id)).size !== 100
  )
    throw new Error(
      `전체 1~100위가 필요합니다. 현재 ${rows.length}개입니다. 페이지가 모두 표시된 뒤 실행하세요.`,
    );
  return {
    format: "oliverank-browser-v1" as const,
    source_url:
      "https://www.oliveyoung.co.kr/store/main/getBestList.do" as const,
    collected_at: now,
    ranking_date: new Intl.DateTimeFormat("sv-SE", {
      timeZone: "Asia/Seoul",
    }).format(new Date(now)),
    category_code: "overall" as const,
    rows,
  };
}
