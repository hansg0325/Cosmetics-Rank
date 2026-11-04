import { validateRows, type RankingRow } from "../../shared/schemas";
import type { RankingSource } from "./RankingSource";
export class ManualImportProvider implements RankingSource {
  readonly type = "MANUAL";
  constructor(private rows: RankingRow[]) {}
  async read() {
    return validateRows(this.rows);
  }
}
