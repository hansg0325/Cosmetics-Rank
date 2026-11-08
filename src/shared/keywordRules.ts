import { z } from "zod";
import words from "./ingredientKeywords.json";
const word = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine((s) => !/[,\r\n]/.test(s), "쉼표와 줄바꿈은 사용할 수 없습니다");
export const keywordRulesSchema = z
  .array(
    z
      .object({
        display: word,
        includes: z.array(word).min(1).max(30),
      })
      .strict(),
  )
  .max(100)
  .refine(
    (rules) =>
      new Set(rules.map((r) => r.display.toLowerCase())).size === rules.length,
    "표시할 단어가 중복됩니다",
  );
export type KeywordRule = z.infer<typeof keywordRulesSchema>[number];
export const defaultKeywordRules: KeywordRule[] = words.map((display) => ({
  display,
  includes:
    display === "PDRN" ? ["PDRN", "피디알엔", "식물성 PDRN"] : [display],
}));
export async function loadKeywordRules(db: D1Database): Promise<KeywordRule[]> {
  const row = await db
    .prepare(
      "SELECT value FROM app_settings WHERE key='ingredient_keyword_rules'",
    )
    .first<{ value: string }>();
  return row
    ? keywordRulesSchema.parse(JSON.parse(row.value))
    : defaultKeywordRules;
}
