import { z } from "zod";
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "실제 날짜가 아닙니다",
  );
const text = z.string().trim().min(1).max(300);
const url = z
  .string()
  .max(2000)
  .refine(
    (s) => !s || (/^https?:\/\//.test(s) && URL.canParse(s)),
    "HTTP(S) URL이 필요합니다",
  );
export const rowSchema = z
  .object({
    ranking_date: day,
    category_code: z.string().regex(/^[a-z0-9_]{1,60}$/),
    rank: z.number().int().min(1).max(100),
    product_id: text,
    brand_name: z.string().max(300).default(""),
    product_name: text,
    product_category: z.string().trim().max(100).optional(),
    product_url: url.default(""),
    list_price: z
      .number()
      .int()
      .nonnegative()
      .max(1e9)
      .nullable()
      .default(null),
    sale_price: z
      .number()
      .int()
      .nonnegative()
      .max(1e9)
      .nullable()
      .default(null),
  })
  .strict();
export type RankingRow = z.infer<typeof rowSchema>;
export const startSchema = z
  .object({
    ranking_date: day,
    category_code: z.string().regex(/^[a-z0-9_]{1,60}$/),
    collected_at: z.string().datetime(),
    source_ref: z.string().max(300),
    replace: z.boolean().default(false),
    source_type: z.enum(["MANUAL", "FIXTURE"]).default("MANUAL"),
  })
  .strict();
export function validateRows(input: unknown[]): RankingRow[] {
  const rows = input.map((r, i) => {
    const p = rowSchema.safeParse(r);
    if (!p.success)
      throw new Error(
        `${i + 2}행: ${p.error.issues.map((x) => x.path.join(".") + " " + x.message).join(", ")}`,
      );
    return p.data;
  });
  const groups = new Map<string, RankingRow[]>();
  for (const r of rows) {
    const k = r.ranking_date + "/" + r.category_code;
    groups.set(k, [...(groups.get(k) || []), r]);
  }
  if (!groups.size) throw new Error("데이터가 없습니다");
  for (const [k, rs] of groups) {
    if (rs.length !== 100 || new Set(rs.map((r) => r.rank)).size !== 100)
      throw new Error(`${k}: 순위 1~100이 각각 한 번 필요합니다`);
    if (new Set(rs.map((r) => r.product_id)).size !== 100)
      throw new Error(`${k}: 상품 ID 중복`);
  }
  return rows;
}
export const safeSpreadsheetText = (s: string) =>
  /^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s;
