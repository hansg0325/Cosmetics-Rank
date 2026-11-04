import { validateRows, type RankingRow } from "../../shared/schemas";
import type { RankingSource } from "./RankingSource";
export class FixtureProvider implements RankingSource {
  readonly type = "FIXTURE";
  constructor(private rows: RankingRow[]) {}
  async read() {
    return validateRows(this.rows);
  }
}
