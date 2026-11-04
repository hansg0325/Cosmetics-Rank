import { describe, it, expect } from "vitest";
import { rankPath, rankY } from "../src/client/RankChart";
import type { HistoryPoint } from "../src/shared/analytics";
describe("순위 그래프 데이터 표현", () => {
  it("1위가 상단, 100위가 하단", () => {
    expect(rankY(1, 100)).toBe(32);
    expect(rankY(100, 100)).toBe(336);
  });
  it("미수집/100위권 밖 구간을 직선으로 잇지 않음", () => {
    const points: HistoryPoint[] = [
      { date: "2026-11-01", rank: 10, state: "RANKED" },
      { date: "2026-11-02", rank: 5, state: "RANKED" },
      { date: "2026-11-03", rank: null, state: "MISSING" },
      { date: "2026-11-04", rank: 3, state: "RANKED" },
      { date: "2026-11-05", rank: null, state: "OUTSIDE_TOP100" },
      { date: "2026-11-06", rank: 1, state: "RANKED" },
    ];
    const path = rankPath(points, 100);
    expect(path.match(/M/g)).toHaveLength(3);
    expect(path.match(/L/g)).toHaveLength(1);
  });
  it("단일 수집일은 가운데 점 위치에 대응", () => {
    expect(
      rankPath([{ date: "2026-11-04", rank: 1, state: "RANKED" }], 10),
    ).toBe("M410.00,32.00");
  });
});
