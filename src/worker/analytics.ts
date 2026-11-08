import collectionCategories from "../shared/collectionCategories.json";
import type { CategoryLeader } from "../shared/dashboardLeaders";
import { categoryShares } from "../shared/marketShare";
import { matchesProductSearch } from "../shared/productSearch";
import { Hono } from "hono";
import { z } from "zod";
import { day } from "../shared/schemas";
import {
  daysBetween,
  shiftDay,
  type ChangeEntry,
  type Comparison,
  type ProductSummary,
  type ProductHistory,
  type ProductHistoryTable,
  type DashboardData,
} from "../shared/analytics";
const category = z.string().regex(/^[a-z0-9_]{1,60}$/);
const query = z.string().trim().max(100);
const id = z.string().trim().min(1).max(300);
const analytics = new Hono<{ Bindings: { DB: D1Database } }>();
type Captured = {
  side: "current" | "previous";
  snapshot_id: number;
  ranking_date: string;
  rank: number;
  product_id: string;
  brand_name_at_capture: string;
  product_name_at_capture: string;
  product_url_at_capture: string;
  list_price: number | null;
  sale_price: number | null;
};
async function rows<T>(statement: D1PreparedStatement, operation: string) {
  const result = await statement.all<T>();
  console.log(
    JSON.stringify({
      operation,
      rows_read: result.meta.rows_read,
      rows_written: result.meta.rows_written,
    }),
  );
  return result.results;
}
export async function comparison(
  db: D1Database,
  date: string,
  cat: string,
): Promise<Comparison> {
  const data = await rows<Captured>(
    db
      .prepare(
        `WITH current AS (SELECT id,ranking_date FROM snapshots WHERE category_code=? AND ranking_date=? AND status='COMPLETE' AND is_active=1), previous AS (SELECT id,ranking_date FROM snapshots WHERE category_code=? AND ranking_date<? AND status='COMPLETE' AND is_active=1 AND EXISTS(SELECT 1 FROM current) ORDER BY ranking_date DESC LIMIT 1)
 SELECT 'current' side,s.id snapshot_id,s.ranking_date,e.* FROM current s JOIN ranking_entries e ON e.snapshot_id=s.id
 UNION ALL SELECT 'previous' side,s.id snapshot_id,s.ranking_date,e.* FROM previous s JOIN ranking_entries e ON e.snapshot_id=s.id`,
      )
      .bind(cat, date, cat, date),
    "comparison",
  );
  const current = data.filter((r) => r.side === "current"),
    previous = data.filter((r) => r.side === "previous");
  const old = new Map(previous.map((r) => [r.product_id, r]));
  const present = new Set(current.map((r) => r.product_id));
  const items: ChangeEntry[] = current.map((r) => {
    const p = old.get(r.product_id);
    const delta = p ? p.rank - r.rank : null;
    return {
      ...r,
      previous_rank: p?.rank ?? null,
      rank_change: delta,
      movement: !previous.length
        ? "UNCOMPARED"
        : !p
          ? "NEW"
          : delta! > 0
            ? "UP"
            : delta! < 0
              ? "DOWN"
              : "SAME",
    };
  });
  items.push(
    ...previous
      .filter((r) => !present.has(r.product_id))
      .map((r) => ({
        ...r,
        rank: null,
        previous_rank: r.rank,
        rank_change: null,
        movement: "EXIT" as const,
      })),
  );
  const counts = { UP: 0, DOWN: 0, SAME: 0, NEW: 0, EXIT: 0, UNCOMPARED: 0 };
  for (const r of items) counts[r.movement]++;
  const compared_to = previous[0]?.ranking_date ?? null;
  return {
    date,
    category: cat,
    has_snapshot: !!current.length,
    snapshot_id: current[0]?.snapshot_id ?? null,
    compared_to,
    missing_days: compared_to
      ? Math.max(0, daysBetween(compared_to, date) - 1)
      : 0,
    items,
    counts,
  };
}
analytics.get("/export-rankings", async (c) => {
  const latest = await rows<{ category_code: string; date: string }>(
    c.env.DB.prepare(
      "SELECT category_code,MAX(ranking_date) date FROM snapshots WHERE status='COMPLETE' AND is_active=1 GROUP BY category_code",
    ),
    "export_rankings",
  );
  const dates = new Map(latest.map((row) => [row.category_code, row.date]));
  const result = await Promise.all(
    Object.keys(collectionCategories).map(async (category) => {
      const date = dates.get(category);
      return date
        ? comparison(c.env.DB, date, category)
        : {
            date: "",
            category,
            has_snapshot: false,
            snapshot_id: null,
            compared_to: null,
            missing_days: 0,
            items: [],
            counts: { UP: 0, DOWN: 0, SAME: 0, NEW: 0, EXIT: 0, UNCOMPARED: 0 },
          };
    }),
  );
  return c.json(
    result.map((result) => ({
      ...result,
      items: result.items
        .filter((row) => row.rank !== null)
        .sort((a, b) => a.rank! - b.rank!),
    })),
  );
});
analytics.get("/collection-status", async (c) => {
  const result = await c.env.DB.prepare(
    "SELECT MAX(collected_at) latest_collected_at FROM snapshots WHERE status='COMPLETE' AND is_active=1",
  ).first<{ latest_collected_at: string | null }>();
  return c.json({ latest_collected_at: result?.latest_collected_at ?? null });
});
analytics.get("/dashboard/leaders", async (c) => {
  type LeaderRow = ChangeEntry & {
    category: string;
    ranking_date: string;
    compared_to: string | null;
  };
  const data = await rows<LeaderRow>(
    c.env.DB.prepare(`
    WITH ordered AS (
      SELECT id,category_code,ranking_date,
        ROW_NUMBER() OVER(PARTITION BY category_code ORDER BY ranking_date DESC,collected_at DESC,id DESC) position
      FROM snapshots WHERE status='COMPLETE' AND is_active=1
    )
    SELECT current.category_code category,current.ranking_date,previous.ranking_date compared_to,
      e.*,old.rank previous_rank
    FROM ordered current JOIN ranking_entries e ON e.snapshot_id=current.id AND e.rank=1
    LEFT JOIN ordered previous ON previous.category_code=current.category_code AND previous.position=2
    LEFT JOIN ranking_entries old ON old.snapshot_id=previous.id AND old.product_id=e.product_id
    WHERE current.position=1
  `),
    "dashboard_leaders",
  );
  const byCategory = new Map(data.map((row) => [row.category, row]));
  const leaders: CategoryLeader[] = Object.entries(collectionCategories).map(
    ([category, info]) => {
      const row = byCategory.get(category);
      return {
        category,
        name: info.name,
        date: row?.ranking_date ?? null,
        compared_to: row?.compared_to ?? null,
        product: row ?? null,
      };
    },
  );
  return c.json(leaders);
});
analytics.get("/dates", async (c) => {
  const cat = category.parse(c.req.query("category"));
  const before = day.optional().parse(c.req.query("before"));
  const data = await rows<{ ranking_date: string }>(
    c.env.DB.prepare(
      "SELECT ranking_date FROM snapshots WHERE category_code=? AND status='COMPLETE' AND is_active=1 AND ranking_date<? ORDER BY ranking_date DESC LIMIT 101",
    ).bind(cat, before || "9999-12-31"),
    "dates",
  );
  return c.json({
    dates: data.slice(0, 100).map((r) => r.ranking_date),
    next_cursor: data.length > 100 ? data[99].ranking_date : null,
  });
});
analytics.get("/market-share", async (c) => {
  const date = day.parse(c.req.query("date"));
  const result = await comparison(c.env.DB, date, "overall");
  const ranked = result.items.filter((row) => row.rank !== null);
  return c.json({
    date,
    has_snapshot: result.has_snapshot,
    total: ranked.length,
    items: categoryShares(ranked),
  });
});
analytics.get("/rankings", async (c) => {
  const date = day.parse(c.req.query("date")),
    cat = category.parse(c.req.query("category")),
    q = query.parse(c.req.query("query") || "").toLowerCase();
  const result = await comparison(c.env.DB, date, cat);
  return c.json(
    result.items
      .filter((r) => r.rank !== null && matchesProductSearch(r, q))
      .sort((a, b) => a.rank! - b.rank!),
  );
});
analytics.get("/changes", async (c) =>
  c.json(
    await comparison(
      c.env.DB,
      day.parse(c.req.query("date")),
      category.parse(c.req.query("category")),
    ),
  ),
);
analytics.get("/products", async (c) => {
  const q = query.parse(c.req.query("query") || ""),
    cursor = id.optional().parse(c.req.query("cursor")),
    limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .parse(c.req.query("limit") || 20);
  const data = await rows<ProductSummary>(
    c.env.DB.prepare(
      `SELECT p.product_id,e.product_name_at_capture product_name,e.brand_name_at_capture brand_name,e.product_url_at_capture product_url,e.product_category_at_capture product_category,s.ranking_date
 FROM products p JOIN ranking_entries e ON e.product_id=p.product_id AND e.snapshot_id=(SELECT e2.snapshot_id FROM ranking_entries e2 JOIN snapshots s2 ON s2.id=e2.snapshot_id WHERE e2.product_id=p.product_id AND s2.status='COMPLETE' AND s2.is_active=1 ORDER BY s2.ranking_date DESC,s2.collected_at DESC,s2.id DESC LIMIT 1) JOIN snapshots s ON s.id=e.snapshot_id
 WHERE p.product_id>? AND (?='' OR instr(lower(e.product_name_at_capture),lower(?))>0 OR instr(lower(COALESCE(e.brand_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(e.manufacturer_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(e.seller_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(e.keywords_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(e.manufacturer_disclosure_at_capture,'')),lower(?))>0) ORDER BY p.product_id LIMIT ?`,
    ).bind(cursor || "", q, q, q, q, q, q, q, limit + 1),
    "products",
  );
  return c.json({
    items: data.slice(0, limit),
    next_cursor: data.length > limit ? data[limit - 1].product_id : null,
  });
});
analytics.get("/product-history", async (c) => {
  const today = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
  }).format(new Date());
  const includeDates =
    z.enum(["0", "1"]).parse(c.req.query("include_dates") || "1") === "1";
  const cursorValue = c.req.query("cursor");
  let cursor: [number, number, string] = [0, 0, ""];
  if (cursorValue) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(cursorValue);
    } catch {
      return c.json({ error: "INVALID_CURSOR" }, 400);
    }
    cursor = z
      .tuple([
        z.number().int().min(1).max(101),
        z.number().int().min(1).max(100),
        id,
      ])
      .parse(parsed);
  }
  const cat = category.parse(c.req.query("category")),
    from = day.parse(c.req.query("from") || today),
    to = day.parse(c.req.query("to") || today),
    q = query.parse(c.req.query("query") || ""),
    focus = id.optional().parse(c.req.query("product_id")),
    status = z
      .enum(["ALL", "RANKED", "EXIT"])
      .parse(c.req.query("status") || "ALL");
  if (daysBetween(from, to) < 0 || daysBetween(from, to) > 179)
    return c.json(
      {
        error: "INVALID_RANGE",
        message: "날짜 범위는 시작일부터 최대 180일입니다.",
      },
      400,
    );
  const db = c.env.DB;
  const latest = await db
    .prepare(
      "SELECT id,ranking_date FROM snapshots WHERE category_code=? AND status='COMPLETE' AND is_active=1 ORDER BY ranking_date DESC LIMIT 1",
    )
    .bind(cat)
    .first<{ id: number; ranking_date: string }>();
  type SummaryRow = ProductSummary &
    ProductHistory["summary"] & {
      current_rank: number | null;
      last_rank: number;
    };
  const summaries = await rows<SummaryRow>(
    db
      .prepare(
        `
    WITH captured AS (
      SELECT e.*,s.ranking_date,s.collected_at,s.id,
        ROW_NUMBER() OVER (PARTITION BY e.product_id ORDER BY s.ranking_date DESC,s.collected_at DESC,s.id DESC) position
      FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id
      WHERE s.category_code=? AND s.status='COMPLETE' AND s.is_active=1
    ), totals AS (
      SELECT product_id,MIN(ranking_date) first_entry_date,MAX(ranking_date) last_record_date,
        MIN(rank) best_rank,MAX(rank) worst_rank,AVG(rank) average_rank,COUNT(*) ranked_days
      FROM captured GROUP BY product_id
    )
    SELECT t.*,m.product_name_at_capture product_name,COALESCE(m.brand_name_at_capture,'') brand_name,
      m.product_url_at_capture product_url,m.product_category_at_capture product_category,m.ranking_date,
      current.rank current_rank,m.rank last_rank
    FROM totals t JOIN captured m ON m.product_id=t.product_id AND m.position=1
    LEFT JOIN ranking_entries current ON current.product_id=t.product_id AND current.snapshot_id=?
    WHERE (COALESCE(current.rank,101),m.rank,t.product_id)>(?,?,?) AND (?='' OR t.product_id=?)
      AND (?='' OR instr(lower(m.product_name_at_capture),lower(?))>0 OR instr(lower(COALESCE(m.brand_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(m.manufacturer_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(m.seller_name_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(m.keywords_at_capture,'')),lower(?))>0 OR instr(lower(COALESCE(m.manufacturer_disclosure_at_capture,'')),lower(?))>0)
      AND (?='ALL' OR (?='RANKED' AND current.rank IS NOT NULL) OR (?='EXIT' AND current.rank IS NULL))
    ORDER BY COALESCE(current.rank,101),m.rank,t.product_id LIMIT 21
  `,
      )
      .bind(
        cat,
        latest?.id ?? 0,
        ...cursor,
        focus || "",
        focus || "",
        q,
        q,
        q,
        q,
        q,
        q,
        q,
        status,
        status,
        status,
      ),
    "product_history_summary",
  );
  const page = summaries.slice(0, 20);
  const dates = Array.from(
    { length: includeDates ? daysBetween(from, to) + 1 : 0 },
    (_, i) => shiftDay(from, i),
  );
  const snapshots = includeDates
    ? await rows<{ id: number; ranking_date: string }>(
        db
          .prepare(
            "SELECT id,ranking_date FROM snapshots WHERE category_code=? AND status='COMPLETE' AND is_active=1 AND ranking_date BETWEEN ? AND ? ORDER BY ranking_date LIMIT 180",
          )
          .bind(cat, from, to),
        "product_history_dates",
      )
    : [];
  const collected = new Set(snapshots.map((s) => s.ranking_date));
  const ranks =
    includeDates && page.length
      ? await rows<{ product_id: string; ranking_date: string; rank: number }>(
          db
            .prepare(
              `SELECT e.product_id,s.ranking_date,e.rank FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE s.category_code=? AND s.status='COMPLETE' AND s.is_active=1 AND s.ranking_date BETWEEN ? AND ? AND e.product_id IN (${page.map(() => "?").join(",")})`,
            )
            .bind(cat, from, to, ...page.map((p) => p.product_id)),
          "product_history_points",
        )
      : [];
  const rankMap = new Map(
    ranks.map((r) => [JSON.stringify([r.product_id, r.ranking_date]), r.rank]),
  );
  const result: ProductHistoryTable = {
    category: cat,
    from,
    to,
    latest_date: latest?.ranking_date ?? null,
    dates,
    next_cursor:
      summaries.length > 20
        ? JSON.stringify([
            page[19].current_rank ?? 101,
            page[19].last_rank,
            page[19].product_id,
          ])
        : null,
    items: page.map((p) => ({
      product: {
        product_id: p.product_id,
        product_name: p.product_name,
        brand_name: p.brand_name,
        product_url: p.product_url,
        product_category: p.product_category,
        ranking_date: p.ranking_date,
      },
      summary: {
        first_entry_date: p.first_entry_date,
        last_record_date: p.last_record_date,
        best_rank: p.best_rank,
        worst_rank: p.worst_rank,
        average_rank: p.average_rank,
        ranked_days: p.ranked_days,
      },
      current_rank: p.current_rank,
      points: dates.map((date) => {
        const rank = rankMap.get(JSON.stringify([p.product_id, date])) ?? null;
        return {
          date,
          rank,
          state: !collected.has(date)
            ? "MISSING"
            : rank === null
              ? "OUTSIDE_TOP100"
              : "RANKED",
        };
      }),
    })),
  };
  return c.json(result);
});
analytics.get("/products/:id/history", async (c) => {
  const productId = id.parse(c.req.param("id")),
    cat = category.parse(c.req.query("category")),
    from = day.parse(c.req.query("from")),
    to = day.parse(c.req.query("to"));
  if (daysBetween(from, to) < 0 || daysBetween(from, to) > 179)
    return c.json(
      {
        error: "INVALID_RANGE",
        message: "날짜 범위는 시작일부터 최대 180일입니다.",
      },
      400,
    );
  const db = c.env.DB;
  const product = await db
    .prepare(
      "SELECT e.product_id,e.product_name_at_capture product_name,e.brand_name_at_capture brand_name,e.product_url_at_capture product_url,e.product_category_at_capture product_category,s.ranking_date FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE e.product_id=? AND s.status='COMPLETE' AND s.is_active=1 ORDER BY s.ranking_date DESC,s.collected_at DESC,s.id DESC LIMIT 1",
    )
    .bind(productId)
    .first<ProductSummary>();
  if (!product) return c.json({ error: "NOT_FOUND" }, 404);
  const summary = await db
    .prepare(
      "SELECT MIN(s.ranking_date) first_entry_date,MIN(e.rank) best_rank,MAX(e.rank) worst_rank,AVG(e.rank) average_rank,COUNT(*) ranked_days,MAX(s.ranking_date) last_record_date FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE e.product_id=? AND s.category_code=? AND s.status='COMPLETE' AND s.is_active=1",
    )
    .bind(productId, cat)
    .first<ProductHistory["summary"]>();
  const data = await rows<{ ranking_date: string; rank: number | null }>(
    db
      .prepare(
        "SELECT s.ranking_date,e.rank FROM snapshots s LEFT JOIN ranking_entries e ON e.snapshot_id=s.id AND e.product_id=? WHERE s.category_code=? AND s.status='COMPLETE' AND s.is_active=1 AND s.ranking_date BETWEEN ? AND ? ORDER BY s.ranking_date LIMIT 180",
      )
      .bind(productId, cat, from, to),
    "history",
  );
  const byDate = new Map(data.map((r) => [r.ranking_date, r.rank]));
  const points = Array.from({ length: daysBetween(from, to) + 1 }, (_, i) => {
    const date = shiftDay(from, i);
    const rank = byDate.get(date) ?? null;
    return {
      date,
      rank,
      state: !byDate.has(date)
        ? ("MISSING" as const)
        : rank === null
          ? ("OUTSIDE_TOP100" as const)
          : ("RANKED" as const),
    };
  });
  return c.json({ product, category: cat, from, to, summary, points });
});
analytics.get("/dashboard", async (c) => {
  const cat = category.parse(c.req.query("category") || "overall"),
    asof = day.parse(
      c.req.query("asof") ||
        new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
          new Date(),
        ),
    );
  const db = c.env.DB;
  const latest = await db
    .prepare(
      "SELECT MAX(ranking_date) date FROM snapshots WHERE category_code=? AND status='COMPLETE' AND is_active=1",
    )
    .bind(cat)
    .first<{ date: string | null }>();
  const totals = await db
    .prepare(
      "SELECT COALESCE(SUM(is_active),0) active,COUNT(*) versions FROM snapshots WHERE category_code=? AND status='COMPLETE'",
    )
    .bind(cat)
    .first<{ active: number; versions: number }>();
  const start = shiftDay(asof, -6),
    utcStart = new Date(start + "T00:00:00+09:00").toISOString(),
    utcEnd = new Date(shiftDay(asof, 1) + "T00:00:00+09:00").toISOString();
  const executions = await rows<{
    date: string;
    complete: number;
    failed: number;
    running: number;
  }>(
    db
      .prepare(
        "SELECT substr(datetime(r.started_at,'+9 hours'),1,10) date,SUM(r.status='COMPLETE') complete,SUM(r.status IN ('FAILED','CANCELLED','PARTIAL')) failed,SUM(r.status='RUNNING') running FROM ingestion_runs r JOIN snapshots s ON s.ingestion_run_id=r.id WHERE s.category_code=? AND r.started_at>=? AND r.started_at<? GROUP BY date ORDER BY date",
      )
      .bind(cat, utcStart, utcEnd),
    "dashboard",
  );
  const byDay = new Map(executions.map((r) => [r.date, r]));
  const result = latest?.date ? await comparison(db, latest.date, cat) : null;
  const data: DashboardData = {
    category: cat,
    latest_date: latest?.date ?? null,
    active_snapshots: totals?.active || 0,
    stored_versions: totals?.versions || 0,
    compared_to: result?.compared_to ?? null,
    missing_days: result?.missing_days || 0,
    top:
      result?.items
        .filter((r) => r.rank !== null)
        .sort((a, b) => a.rank! - b.rank!)
        .slice(0, 10) || [],
    rising:
      result?.items
        .filter((r) => r.movement === "UP")
        .sort((a, b) => b.rank_change! - a.rank_change!)
        .slice(0, 10) || [],
    new_entries:
      result?.items
        .filter((r) => r.movement === "NEW")
        .sort((a, b) => a.rank! - b.rank!)
        .slice(0, 10) || [],
    days: Array.from({ length: 7 }, (_, i) => {
      const date = shiftDay(start, i),
        r = byDay.get(date) || { complete: 0, failed: 0, running: 0 };
      return {
        date,
        complete: r.complete,
        failed: r.failed,
        running: r.running,
        status: r.complete
          ? "COMPLETE"
          : r.running
            ? "RUNNING"
            : r.failed
              ? "FAILED"
              : "MISSING",
      };
    }),
  };
  return c.json(data);
});
export default analytics;
