import type { RankingRow } from "../../shared/schemas";
export interface RankingSource {
  readonly type: "MANUAL" | "FIXTURE";
  read(): Promise<RankingRow[]>;
}
export const scheduleStatus = "DISABLED_NO_APPROVED_SOURCE";
