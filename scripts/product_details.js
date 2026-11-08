// Read only the current, rendered product page. No fetch, XHR or navigation.
const expectedId = arguments[0];
const expectedName = arguments[1] || "";
const url = new URL(location.href);
const normalize = (text) => text.replace(/\s/g, "");
const scope =
  document.querySelector('[class*="GoodsDetailInfo_goods-info"]') ||
  document.querySelector("#Contents .prd_detail_box");
const heading = Array.from(document.querySelectorAll("h1,h2,h3")).some(
  (e) => expectedName && normalize(e.innerText) === normalize(expectedName),
);
const valid =
  url.hostname === "www.oliveyoung.co.kr" &&
  url.pathname === "/store/goods/getGoodsDetail.do" &&
  url.searchParams.get("goodsNo") === expectedId &&
  !!(scope || heading);
if (!valid) return null;

const fields = Array.from(document.querySelectorAll("tr"))
  .map((row) => {
    const cells = Array.from(row.querySelectorAll(":scope > th,:scope > td"));
    return cells.length > 1
      ? {
          label: normalize(cells[0].innerText),
          text: cells
            .slice(1)
            .map((e) => e.innerText.trim())
            .join("\n"),
        }
      : null;
  })
  .filter(Boolean);
const manufacturers = fields.filter(
  (f) =>
    f.label.includes("화장품제조업자") &&
    f.label.includes("화장품책임판매업자"),
);
const ingredientFields = fields.filter(
  (f) => f.label === "화장품법에따라기재해야하는모든성분",
);
let ingredients = ingredientFields.length
  ? ingredientFields
      .map((f) => f.text)
      .join("\n")
      .trim()
  : null;
if (
  ingredients &&
  /^(상세\s*(페이지|설명|정보)|제품\s*상세|이미지|별도\s*표시).{0,30}(참조|참고|확인)[.\s]*$/.test(
    ingredients,
  )
)
  ingredients = null;

// Restrict fallback to the product header, before tabs/recommendations/reviews.
const text = (
  scope?.innerText || document.body.innerText.split("상품설명")[0]
).slice(0, 10000);
const pair = text.match(
  /평점\s*([0-9]+(?:\.[0-9]+)?)\s*리뷰\s*([0-9][0-9,]*)\s*건/,
);
let review_count = null;
let rating = null;
let review_status = "NOT_RENDERED";
if (pair) {
  const count = Number(pair[2].replaceAll(",", ""));
  const score = Number(pair[1]);
  if (
    Number.isSafeInteger(count) &&
    count >= 0 &&
    count <= 1000000000 &&
    score >= 0 &&
    score <= 5
  ) {
    review_count = count;
    rating = count === 0 ? null : score;
    review_status = "FOUND";
  } else review_status = "INVALID_SUMMARY";
} else if (/리뷰\s*0\s*건/.test(text)) {
  review_count = 0;
  review_status = "FOUND";
}
return {
  product_id: expectedId,
  raw: manufacturers.length
    ? manufacturers.map((f) => f.text).join("\n")
    : null,
  ingredients: ingredients || null,
  disclosure_checked:
    manufacturers.length > 0 ||
    fields.some((f) =>
      /내용물|제품주요사양|사용기한|제조국|품명|모델명|제품명|제조업소|원재료/.test(
        f.label,
      ),
    ),
  review_count,
  rating,
  review_status,
};
