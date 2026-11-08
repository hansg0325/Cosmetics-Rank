import type { RankingRow } from "../../shared/schemas";
export interface RankingSource {
  readonly type: "MANUAL" | "FIXTURE";
  read(): Promise<RankingRow[]>;
}
export const scheduleStatus = "GITHUB_ACTIONS_DAILY_06_KST";
