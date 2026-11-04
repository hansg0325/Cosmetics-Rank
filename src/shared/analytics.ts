export type Movement = "UP" | "DOWN" | "SAME" | "NEW" | "EXIT" | "UNCOMPARED";
export type ChangeEntry = {
  product_id: string;
  rank: number | null;
  previous_rank: number | null;
  rank_change: number | null;
  movement: Movement;
  brand_name_at_capture: string;
  product_name_at_capture: string;
  product_url_at_capture: string;
  product_category_at_capture?: string | null;
  list_price?: number | null;
  sale_price?: number | null;
};
export type Comparison = {
  date: string;
  category: string;
  has_snapshot: boolean;
  snapshot_id: number | null;
  compared_to: string | null;
  missing_days: number;
  items: ChangeEntry[];
  counts: Record<Movement, number>;
};
export type HistoryPoint = {
  date: string;
  rank: number | null;
  state: "RANKED" | "OUTSIDE_TOP100" | "MISSING";
};
export type ProductSummary = {
  product_id: string;
  product_name: string;
  brand_name: string;
  product_url: string;
  product_category?: string | null;
  ranking_date: string;
};
export type ProductHistory = {
  product: ProductSummary;
  category: string;
  from: string;
  to: string;
  summary: {
    first_entry_date: string | null;
    best_rank: number | null;
    last_record_date: string | null;
  };
  points: HistoryPoint[];
};
export type DashboardData = {
  category: string;
  latest_date: string | null;
  active_snapshots: number;
  stored_versions: number;
  compared_to: string | null;
  missing_days: number;
  top: ChangeEntry[];
  rising: ChangeEntry[];
  new_entries: ChangeEntry[];
  days: {
    date: string;
    complete: number;
    failed: number;
    running: number;
    status: "COMPLETE" | "FAILED" | "RUNNING" | "MISSING";
  }[];
};
export function daysBetween(from: string, to: string) {
  return Math.round(
    (Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) /
      86400000,
  );
}
export function shiftDay(date: string, delta: number) {
  return new Date(Date.parse(date + "T00:00:00Z") + delta * 86400000)
    .toISOString()
    .slice(0, 10);
}
