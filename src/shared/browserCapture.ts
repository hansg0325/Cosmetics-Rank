import { z } from "zod";
import { day, validateRows } from "./schemas";
export const browserCaptureSchema = z
  .object({
    format: z.literal("oliverank-browser-v1"),
    source_url: z.literal(
      "https://www.oliveyoung.co.kr/store/main/getBestList.do",
    ),
    collected_at: z.string().datetime(),
    ranking_date: day,
    category_code: z.literal("overall"),
    rows: z
      .array(
        z
          .object({
            rank: z.number().int().min(1).max(100),
            product_id: z.string().regex(/^A\d{12}$/),
            brand_name: z.string().trim().min(1).max(300),
            product_name: z.string().trim().min(1).max(300),
            product_category: z.string().trim().max(100).optional(),
            product_url: z.string().max(2000),
          })
          .strict(),
      )
      .length(100),
  })
  .strict()
  .superRefine((c, ctx) => {
    if (
      new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
        new Date(c.collected_at),
      ) !== c.ranking_date
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "수집 시각과 KST 날짜가 다릅니다",
      });
    for (const r of c.rows)
      if (
        r.product_url !==
        `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${r.product_id}`
      )
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "상품 ID와 원본 링크가 다릅니다",
        });
  });
export type BrowserCapture = z.infer<typeof browserCaptureSchema>;
export function parseBrowserCapture(input: unknown) {
  const capture = browserCaptureSchema.parse(input);
  const rows = validateRows(
    capture.rows.map((r) => ({
      ...r,
      ranking_date: capture.ranking_date,
      category_code: capture.category_code,
    })),
  );
  return { capture, rows };
}
