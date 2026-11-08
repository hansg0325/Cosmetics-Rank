import type { ChangeEntry } from "./analytics";
export type CategoryLeader = {
  category: string;
  name: string;
  date: string | null;
  compared_to: string | null;
  product:
    | (Partial<ChangeEntry> & {
        product_id: string;
        product_name_at_capture: string;
      })
    | null;
};
