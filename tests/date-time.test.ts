import { expect, it } from "vitest";
import { formatCollectedAt } from "../src/shared/dateTime";
it("수집 시각을 한국 시간의 날짜·시·분·초로 표시", () => {
  expect(formatCollectedAt("2026-11-04T16:02:03Z")).toBe("2026-11-05 01:02:03");
  expect(formatCollectedAt("2026-11-05T00:00:00+09:00")).toBe(
    "2026-11-05 00:00:00",
  );
  expect(formatCollectedAt(null)).toBe("—");
  expect(formatCollectedAt("invalid")).toBe("—");
});
