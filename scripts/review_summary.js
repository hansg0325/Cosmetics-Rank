// Runs in the public Olive Young browser context. Only aggregate review data
// is returned; individual reviews, account data and media are not retained.
const ids = arguments[0];
const done = arguments[arguments.length - 1];
async function request(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw Error(
      "HTTP " +
        response.status +
        " " +
        url.split("?")[0] +
        " retry-after=" +
        (response.headers.get("retry-after") || "60"),
    );
  return response;
}
function goodsData(html, expectedId) {
  const chunks = Array.from(html.matchAll(/self\.__next_f\.push\((\[.*?\])\)/g))
    .map((match) => {
      try {
        const row = JSON.parse(match[1]);
        return row[0] === 1 ? row[1] : "";
      } catch {
        return "";
      }
    })
    .join("");
  let goods;
  function walk(value) {
    if (!value || typeof value !== "object") return;
    if (
      value.queryKey?.[0] === "goods" &&
      value.state?.data?.data?.goodsNumber === expectedId
    )
      goods = value.state.data.data;
    for (const child of Object.values(value)) walk(child);
  }
  for (const line of chunks.split("\n")) {
    try {
      walk(JSON.parse(line.slice(line.indexOf(":") + 1)));
    } catch {
      /* other Flight records */
    }
  }
  if (!goods) throw Error("상품 식별 정보 없음");
  return goods;
}
async function summary(id) {
  const html = await (
    await request(
      "/store/goods/getGoodsDetail.do?goodsNo=" + encodeURIComponent(id),
    )
  ).text();
  const goods = goodsData(html, id);
  const payload = {};
  for (const key of [
    "goodsNumber",
    "deliveryFreeFlag",
    "leadTime",
    "goodsTypeCode",
    "tradeCode",
    "supplier",
    "onlineBrand",
    "orderableMinimumQuantity",
    "deliveryPolicyNumber",
    "goodsSectionCode",
  ])
    payload[key] = goods[key];
  payload.todayDeliveryCheckedFlag = false;
  payload.appFlag = false;
  payload.options = goods.options.map((option) => ({
    optionNumber: option.optionNumber,
    standardCode: option.standardCode,
    brand: option.brand,
    representFlag: option.representFlag,
    lowerCategoryNumber: option.standardCategory?.lowerCategory,
    discountApplyFlag: option.discountApplyFlag,
    todayDeliveryFlag: option.todayDeliveryFlag,
    soldOutFlag: option.soldOutFlag,
    reservationFlag: option.reservationFlag,
  }));
  const json = await (
    await request("/goods/api/v1/extra", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  ).json();
  const info = json.data?.reviewInfoDto;
  if (
    info?.goodsNo !== id ||
    !Number.isSafeInteger(info.reviewCnt) ||
    info.reviewCnt < 0 ||
    (info.reviewCnt > 0 &&
      (!Number.isFinite(info.reviewAvgScore) ||
        info.reviewAvgScore < 0 ||
        info.reviewAvgScore > 5))
  )
    throw Error("리뷰 요약 형식 오류");
  return {
    product_id: id,
    review_count: info.reviewCnt,
    rating: info.reviewCnt === 0 ? null : info.reviewAvgScore,
  };
}
(async () => {
  const results = [];
  let failures = 0;
  // Bounded sequential requests; stop on repeated failures instead of retrying.
  for (const id of ids) {
    if (failures >= 3) {
      results.push({ product_id: id, review_count: null, rating: null });
      continue;
    }
    try {
      results.push(await summary(id));
      failures = 0;
    } catch (error) {
      results.push({
        product_id: id,
        review_count: null,
        rating: null,
        error: String(error),
      });
      failures++;
      if (/HTTP (429|403)/.test(String(error))) failures = 3;
    }
    await new Promise((resolve) => setTimeout(resolve, 600));
  }
  done(results);
})().catch(() => done([]));
