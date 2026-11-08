import { loadKeywordRules, keywordRulesSchema } from "../shared/keywordRules";
import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z, ZodError } from "zod";
import { rowSchema, startSchema } from "../shared/schemas";
import { scheduleStatus } from "./providers/RankingSource";
import { collector } from "./collector";
import analytics from "./analytics";
type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  LOCAL_DEV_TOKEN?: string;
  COLLECTION_API_KEY?: string;
  ACCESS_TEAM: string;
  ACCESS_AUD: string;
  ALLOWED_EMAIL: string;
  VIEWER_EMAILS?: string;
};
type Role = "admin" | "viewer";
const app = new Hono<{ Bindings: Env; Variables: { role: Role } }>();
const keysets = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
app.use("*", async (c, next) => {
  const url = new URL(c.req.url);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  // The desktop-only server binds to loopback. Its helper still uses the
  // internal token, but opening the local UI requires no login.
  let role: Role | null = local && !!c.env.LOCAL_DEV_TOKEN ? "admin" : null;
  const machinePath = /^\/api\/imports(?:\/[^/]+\/(?:chunks|complete|cancel))?$/.test(url.pathname) ||
    (c.req.method === "GET" && url.pathname === "/api/settings/keywords");
  if (!role && machinePath && c.env.COLLECTION_API_KEY && c.req.header("authorization")) {
    const encoder = new TextEncoder();
    const provided = await crypto.subtle.digest("SHA-256", encoder.encode(c.req.header("authorization")!));
    const expected = await crypto.subtle.digest("SHA-256", encoder.encode(`Bearer ${c.env.COLLECTION_API_KEY}`));
    if (timingSafeEqual(new Uint8Array(provided), new Uint8Array(expected))) role = "admin";
  }
  if (!role && c.env.ACCESS_TEAM && c.env.ACCESS_AUD && c.env.ALLOWED_EMAIL) {
    try {
      const issuer = `https://${c.env.ACCESS_TEAM}.cloudflareaccess.com`;
      if (!/^[a-z0-9-]+$/.test(c.env.ACCESS_TEAM)) throw Error();
      let keys = keysets.get(issuer);
      if (!keys) {
        keys = createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs"));
        keysets.set(issuer, keys);
      }
      const { payload } = await jwtVerify(
        c.req.header("cf-access-jwt-assertion") || "",
        keys,
        { issuer, audience: c.env.ACCESS_AUD },
      );
      const email =
        typeof payload.email === "string" ? payload.email.toLowerCase() : "";
      const adminEmail = c.env.ALLOWED_EMAIL.trim().toLowerCase();
      const viewerEmails = (c.env.VIEWER_EMAILS || "")
        .split(",")
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);
      if (email && email === adminEmail) role = "admin";
      else if (email && viewerEmails.includes(email)) role = "viewer";
    } catch {
      /* fail closed */
    }
  }
  if (!role) {
    return c.json({ error: "UNAUTHORIZED" }, 401);
  }
  c.set("role", role);
  if (c.req.method === "POST" && c.req.header("origin") !== url.origin)
    return c.json({ error: "INVALID_ORIGIN" }, 403);
  c.header("Cache-Control", "no-store");
  c.header("X-Content-Type-Options", "nosniff");
  await next();
});
app.use("/api/*", async (c, next) => {
  const path = new URL(c.req.url).pathname;
  if (
    c.get("role") !== "admin" &&
    (c.req.method !== "GET" ||
      path === "/api/imports" ||
      path.startsWith("/api/imports/") ||
      path === "/api/export-rankings" ||
      path === "/api/settings/keywords" ||
      path.startsWith("/api/collector/"))
  )
    return c.json({ error: "FORBIDDEN" }, 403);
  await next();
});
app.use(
  "/api/*",
  bodyLimit({
    maxSize: 64 * 1024,
    onError: (c) => c.json({ error: "PAYLOAD_TOO_LARGE" }, 413),
  }),
);
app.onError((err, c) => {
  if (err instanceof ZodError)
    return c.json({ error: "VALIDATION", details: err.issues }, 400);
  if (err instanceof SyntaxError) return c.json({ error: "INVALID_JSON" }, 400);
  console.error("request_failed", err.message);
  return c.json({ error: "IMPORT_CONFLICT_OR_DATABASE_ERROR" }, 409);
});
app.get("/api/health", (c) => c.json({ ok: true, schedule: scheduleStatus }));
app.get("/api/me", (c) => c.json({ role: c.get("role") }));
app.get("/api/settings/keywords", async (c) =>
  c.json(await loadKeywordRules(c.env.DB)),
);
app.post("/api/settings/keywords", async (c) => {
  const rules = keywordRulesSchema.parse(await c.req.json());
  await c.env.DB.prepare(
    "INSERT INTO app_settings(key,value) VALUES('ingredient_keyword_rules',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
    .bind(JSON.stringify(rules))
    .run();
  return c.json({ saved: true });
});
app.route("/api/collector", collector);
app.get("/api/categories", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT code,display_name FROM categories WHERE is_active=1 ORDER BY sort_order",
      ).all()
    ).results,
  ),
);
app.get("/api/imports", async (c) => {
  const offset = z.coerce
    .number()
    .int()
    .min(0)
    .max(100000)
    .parse(c.req.query("offset") || 0);
  const limit = z.coerce
    .number()
    .int()
    .min(1)
    .max(101)
    .parse(c.req.query("limit") || 100);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT r.*,s.id snapshot_id,s.ranking_date,s.collected_at,s.category_code,s.status snapshot_status,s.entry_count,s.is_active FROM ingestion_runs r JOIN snapshots s ON s.ingestion_run_id=r.id ORDER BY r.started_at DESC,r.id LIMIT ? OFFSET ?",
      )
        .bind(limit, offset)
        .all()
    ).results,
  );
});
app.route("/api", analytics);
app.post("/api/imports", async (c) => {
  const p = startSchema.parse(await c.req.json());
  const db = c.env.DB;
  if (
    !(await db
      .prepare("SELECT code FROM categories WHERE code=? AND is_active=1")
      .bind(p.category_code)
      .first())
  )
    return c.json({ error: "UNKNOWN_CATEGORY" }, 400);
  const active = await db
    .prepare(
      "SELECT id,ingestion_run_id,source_ref FROM snapshots WHERE ranking_date=? AND category_code=? AND is_active=1",
    )
    .bind(p.ranking_date, p.category_code)
    .first<{ id: number; ingestion_run_id: string; source_ref: string }>();
  if (active) {
    if (active.source_ref === p.source_ref)
      return c.json({
        id: active.ingestion_run_id,
        snapshot_id: active.id,
        already_complete: true,
      });
    if (!p.replace)
      return c.json({ error: "REPLACEMENT_CONFIRMATION_REQUIRED" }, 409);
  }
  const id = crypto.randomUUID();
  await db.batch([
    db
      .prepare(
        "INSERT INTO ingestion_runs(id,trigger_type,status,source_ref) VALUES(?,?,'RUNNING',?)",
      )
      .bind(id, p.source_type, p.source_ref),
    db
      .prepare(
        "INSERT INTO snapshots(ranking_date,category_code,version,ingestion_run_id,source_type,source_ref,collected_at) SELECT ?,?,COALESCE(MAX(version),0)+1,?,?,?,? FROM snapshots WHERE ranking_date=? AND category_code=?",
      )
      .bind(
        p.ranking_date,
        p.category_code,
        id,
        p.source_type,
        p.source_ref,
        p.collected_at,
        p.ranking_date,
        p.category_code,
      ),
  ]);
  const snapshot = await db
    .prepare("SELECT id FROM snapshots WHERE ingestion_run_id=?")
    .bind(id)
    .first();
  return c.json(
    { id, snapshot_id: snapshot?.id, already_complete: false },
    201,
  );
});
const idSchema = z.string().uuid();
app.post("/api/imports/:id/chunks", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const rows = z
    .object({ rows: z.array(rowSchema).min(1).max(20) })
    .strict()
    .parse(await c.req.json()).rows;
  const db = c.env.DB;
  const s = await db
    .prepare(
      "SELECT s.* FROM snapshots s JOIN ingestion_runs r ON r.id=s.ingestion_run_id WHERE r.id=? AND r.status='RUNNING' AND s.status='IMPORTING'",
    )
    .bind(id)
    .first<{ id: number; ranking_date: string; category_code: string }>();
  if (!s) return c.json({ error: "IMPORT_NOT_OPEN" }, 409);
  if (
    rows.some(
      (r) =>
        r.ranking_date !== s.ranking_date ||
        r.category_code !== s.category_code,
    )
  )
    return c.json({ error: "SNAPSHOT_MISMATCH" }, 400);
  const queries: D1PreparedStatement[] = [];
  for (const r of rows) {
    queries.push(
      db
        .prepare(
          "INSERT INTO products(product_id,brand_name,product_name,product_url) VALUES(?,?,?,?) ON CONFLICT(product_id) DO NOTHING",
        )
        .bind(r.product_id, r.brand_name, r.product_name, r.product_url),
      db
        .prepare(
          "INSERT INTO ranking_entries(snapshot_id,rank,product_id,brand_name_at_capture,product_name_at_capture,list_price,sale_price,product_url_at_capture,product_category_at_capture,review_count_at_capture,rating_at_capture,manufacturer_name_at_capture,seller_name_at_capture,manufacturer_disclosure_at_capture,keywords_at_capture) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(snapshot_id,rank) DO NOTHING",
        )
        .bind(
          s.id,
          r.rank,
          r.product_id,
          r.brand_name,
          r.product_name,
          null,
          null,
          r.product_url,
          r.product_category || null,
          r.review_count ?? null,
          r.rating ?? null,
          r.manufacturer_name ?? null,
          r.seller_name ?? null,
          r.manufacturer_disclosure ?? null,
          r.keywords?.join(", ") ?? null,
        ),
    );
  }
  queries.push(
    db
      .prepare(
        "UPDATE snapshots SET entry_count=(SELECT COUNT(*) FROM ranking_entries WHERE snapshot_id=?) WHERE id=?",
      )
      .bind(s.id, s.id),
  );
  const results = await db.batch(queries);
  console.log(
    JSON.stringify({
      operation: "chunk",
      rows_read: results.reduce((n, r) => n + r.meta.rows_read, 0),
      rows_written: results.reduce((n, r) => n + r.meta.rows_written, 0),
    }),
  );
  return c.json({ accepted: rows.length });
});
app.post("/api/imports/:id/complete", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const p = z
    .object({ replace: z.boolean().default(false) })
    .strict()
    .parse(await c.req.json());
  const db = c.env.DB;
  const s = await db
    .prepare("SELECT * FROM snapshots WHERE ingestion_run_id=?")
    .bind(id)
    .first<{
      id: number;
      status: string;
      ranking_date: string;
      category_code: string;
    }>();
  if (!s) return c.json({ error: "NOT_FOUND" }, 404);
  if (s.status === "COMPLETE")
    return c.json({ status: "COMPLETE", already_complete: true });
  if (s.status !== "IMPORTING")
    return c.json({ error: "IMPORT_NOT_OPEN" }, 409);
  const stats = await db
    .prepare(
      "SELECT COUNT(*) n,MIN(rank) lo,MAX(rank) hi FROM ranking_entries WHERE snapshot_id=?",
    )
    .bind(s.id)
    .first<{ n: number; lo: number; hi: number }>();
  if (stats?.n !== 100 || stats.lo !== 1 || stats.hi !== 100)
    return c.json({ error: "INCOMPLETE_RANKS", count: stats?.n }, 422);
  const queries: D1PreparedStatement[] = [];
  if (p.replace)
    queries.push(
      db
        .prepare(
          "UPDATE snapshots SET is_active=0 WHERE ranking_date=? AND category_code=? AND is_active=1 AND id<>? AND EXISTS(SELECT 1 FROM snapshots WHERE id=? AND status='IMPORTING')",
        )
        .bind(s.ranking_date, s.category_code, s.id, s.id),
    );
  queries.push(
    db
      .prepare(
        "UPDATE snapshots SET status='COMPLETE',is_active=1,entry_count=100,completed_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='IMPORTING'",
      )
      .bind(s.id),
    db
      .prepare(
        "UPDATE products SET brand_name=e.brand_name_at_capture,product_name=e.product_name_at_capture,product_url=e.product_url_at_capture,updated_at=s.collected_at FROM ranking_entries e JOIN snapshots s ON s.id=e.snapshot_id WHERE e.snapshot_id=? AND s.status='COMPLETE' AND s.is_active=1 AND products.product_id=e.product_id AND products.updated_at<=s.collected_at",
      )
      .bind(s.id),
    db
      .prepare(
        "UPDATE ingestion_runs SET status='COMPLETE',finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=? AND status='RUNNING' AND EXISTS(SELECT 1 FROM snapshots WHERE ingestion_run_id=? AND status='COMPLETE')",
      )
      .bind(id, id),
  );
  await db.batch(queries);
  const final = await db
    .prepare("SELECT status FROM snapshots WHERE id=?")
    .bind(s.id)
    .first<{ status: string }>();
  if (final?.status !== "COMPLETE")
    return c.json({ error: "IMPORT_NOT_OPEN" }, 409);
  return c.json({ status: "COMPLETE" });
});
app.post("/api/imports/:id/cancel", async (c) => {
  const id = idSchema.parse(c.req.param("id"));
  const p = z
    .object({ failed: z.boolean().default(false) })
    .strict()
    .parse(await c.req.json());
  const db = c.env.DB;
  const run = await db
    .prepare("SELECT status FROM ingestion_runs WHERE id=?")
    .bind(id)
    .first<{ status: string }>();
  if (!run) return c.json({ error: "NOT_FOUND" }, 404);
  if (run.status === "COMPLETE")
    return c.json({ error: "ALREADY_COMPLETE" }, 409);
  await db.batch([
    db
      .prepare(
        "UPDATE snapshots SET status='FAILED' WHERE ingestion_run_id=? AND status='IMPORTING'",
      )
      .bind(id),
    db
      .prepare(
        "UPDATE ingestion_runs SET status=?,finished_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),error_message=? WHERE id=? AND status='RUNNING'",
      )
      .bind(
        p.failed ? "FAILED" : "CANCELLED",
        p.failed ? "클라이언트 업로드 실패" : null,
        id,
      ),
  ]);
  const final = await db
    .prepare("SELECT status FROM ingestion_runs WHERE id=?")
    .bind(id)
    .first<{ status: string }>();
  if (final?.status === "COMPLETE")
    return c.json({ error: "ALREADY_COMPLETE" }, 409);
  return c.json({ status: final?.status });
});
app.all("/api/*", (c) => c.json({ error: "NOT_FOUND" }, 404));
app.all("*", (c) => c.env.ASSETS.fetch(c.req.raw));
export default app;
