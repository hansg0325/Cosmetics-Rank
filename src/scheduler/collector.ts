import app from "../worker/index";
import categories from "../shared/collectionCategories.json";
import { loadKeywordRules } from "../shared/keywordRules";
import {
  billingPeriod,
  browserCost,
  canReserve,
  chunksByBytes,
  MONTHLY_BROWSER_LIMIT_MS,
  STEP_RESERVATION_MS,
  RUN_BROWSER_LIMIT_MS,
} from "./budget";
import {
  detailScript,
  rankingScript,
  type Detail,
  type Fields,
  type Product,
} from "./browser";

export interface BrowserBinding {
  script(
    code: string,
    options: {
      library: string;
      timeout: number;
      keepAlive?: number;
      sessionId?: string;
      targetId?: string;
    },
  ): Promise<Response>;
  closeSession(id: string): Promise<unknown>;
  getSession(id: string): Promise<unknown | null>;
}
export type CollectorEnv = {
  DB: D1Database;
  BROWSER: BrowserBinding;
  COLLECTOR: DurableObjectNamespace;
  COLLECTOR_CONTROL_TOKEN: string;
  BILLING_ANCHOR_DAY?: string;
  SCHEDULE_SMOKE?: string;
  SMOKE_PRODUCT_IDS?: string;
};
type Ledger = { period: string; usedMs: number; legacyReserveMs: number };
type Cached = {
  checkedAt: number;
  fields: Pick<
    Fields,
    "raw" | "ingredients" | "disclosure_checked" | "cosmetic_disclosure"
  >;
};
export type CollectionRun = {
  id: string;
  trigger: string;
  status: string;
  phase: "rankings" | "details" | "save";
  startedAt: string;
  finishedAt?: string;
  rankingDate: string;
  period: string;
  dryRun: boolean;
  detailLimit: number;
  categoryIndex: number;
  detailIndex: number;
  saveIndex: number;
  productIds: string[];
  targetIds: string[];
  uniqueProducts?: number;
  targetCount?: number;
  preferredIds?: string[];
  browserMs: number;
  lastReportedMs: number;
  sessionId?: string;
  targetId?: string;
  closeStatus: string;
  stopReason?: string;
  rankingCount: number;
  savedCategories: number;
  validDetails: number;
  blocked: number;
  ingredients: number;
  disclosures: number;
  reviews: number;
  ratings: number;
  staticReused: number;
  error?: string;
  unknownSessionUntil?: number;
  uncertainBrowserMs?: number;
  failedDetails?: number;
  issues?: { id: string; reason: string; diagnostic?: unknown }[];
  recoverable?: boolean;
  resumeCount?: number;
};
const codes = Object.keys(categories) as (keyof typeof categories)[];
const STATIC_TTL_MS = 7 * 24 * 3_600_000;
const json = (value: unknown, status = 200) => Response.json(value, { status });
const dayKst = () =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(
    new Date(),
  );

export function topCategory(path: string) {
  const parts = path
    .split(">")
    .map((s) => s.trim())
    .filter(Boolean);
  const roots: Record<string, string> = {
    "02": "메이크업",
    "03": "향수/디퓨저",
    "04": "바디케어",
    "05": "헤어케어",
  };
  return roots[parts[0]] || parts.find((s) => !/^\d+$/.test(s)) || "";
}

export class CloudCollector {
  private stepping = false;
  constructor(
    private ctx: DurableObjectState,
    private env: CollectorEnv,
  ) {}

  private async ledger(period: string): Promise<Ledger> {
    return (
      (await this.ctx.storage.get<Ledger>(`budget:${period}`)) || {
        period,
        usedMs: 3_600_000,
        legacyReserveMs: 3_600_000,
      }
    );
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "POST" && url.pathname === "/resume") {
      const input = (await request.json()) as { id: string };
      return this.ctx.blockConcurrencyWhile(async () => {
        const active = await this.ctx.storage.get<CollectionRun>("active");
        if (active && active.status === "RUNNING")
          return json({ jobId: active.id, alreadyRunning: true }, 202);
        const run =
          active ||
          (await this.ctx.storage.get<CollectionRun>(`checkpoint:${input.id}`));
        if (
          !run ||
          run.id !== input.id ||
          run.phase !== "details" ||
          run.status !== "FAILED" ||
          (run.resumeCount || 0) >= 2
        )
          return json({ error: "NOT_RESUMABLE" }, 409);
        if (
          run.rankingDate !== dayKst() ||
          run.period !==
            billingPeriod(new Date(), Number(this.env.BILLING_ANCHOR_DAY || 8))
        )
          return json({ error: "STALE_CHECKPOINT" }, 409);
        if (!/^BROWSER_API_(408|410|5\d\d)$/.test(run.error || ""))
          return json({ error: "NOT_RESUMABLE" }, 409);
        await this.close(run);
        run.status = "RUNNING";
        run.resumeCount = (run.resumeCount || 0) + 1;
        run.lastReportedMs = 0;
        delete run.error;
        delete run.stopReason;
        delete run.finishedAt;
        delete run.unknownSessionUntil;
        await this.ctx.storage.put({ active: run, cancelRequested: false });
        await this.ctx.storage.setAlarm(Date.now() + 1);
        return json({ jobId: run.id, resumedFrom: run.detailIndex }, 202);
      });
    }
    if (request.method === "GET" && url.pathname === "/status") {
      const active = await this.ctx.storage.get<CollectionRun>("active");
      const period = billingPeriod(
        new Date(),
        Number(this.env.BILLING_ANCHOR_DAY || 8),
      );
      const ledger = await this.ledger(period);
      const history =
        (await this.ctx.storage.get<CollectionRun[]>("history")) || [];
      return json({
        collectorVersion: "v6-diagnostic",
        active: active || null,
        history,
        budget: {
          ...ledger,
          limitMs: MONTHLY_BROWSER_LIMIT_MS,
          estimatedBrowserCost: browserCost(ledger.usedMs),
          estimatedBaseAndBrowserCost: 5 + browserCost(ledger.usedMs),
          totalBillCapGuaranteed: false,
        },
        intervalSeconds: 2,
        maxConcurrentBrowsers: 1,
      });
    }
    if (request.method === "POST" && url.pathname === "/cancel") {
      await this.ctx.storage.put("cancelRequested", true);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return json({ cancellationRequested: true }, 202);
    }
    if (request.method !== "POST" || url.pathname !== "/start")
      return json({ error: "NOT_FOUND" }, 404);
    const input = (await request.json()) as {
      dryRun?: boolean;
      detailLimit?: number;
      trigger?: string;
      scheduledAt?: string;
      preferredIds?: string[];
      diagnosticOnly?: boolean;
    };
    return this.ctx.blockConcurrencyWhile(async () => {
      const active = await this.ctx.storage.get<CollectionRun>("active");
      if (active) return json({ jobId: active.id, alreadyRunning: true }, 202);
      const trigger = input.trigger === "cron" ? "cron" : "manual";
      const rankingDate = dayKst();
      if (
        trigger === "cron" &&
        (await this.ctx.storage.get(`scheduled:${rankingDate}`))
      )
        return json({ alreadyStartedToday: true });
      const period = billingPeriod(
        new Date(),
        Number(this.env.BILLING_ANCHOR_DAY || 8),
      );
      const ledger = await this.ledger(period);
      if (!canReserve(ledger.usedMs, 0))
        return json({ error: "BROWSER_BUDGET_EXHAUSTED" }, 429);
      const run: CollectionRun = {
        id: crypto.randomUUID(),
        trigger,
        status: "RUNNING",
        phase: "rankings",
        startedAt: new Date().toISOString(),
        rankingDate,
        period,
        dryRun: input.dryRun === true,
        detailLimit:
          input.dryRun === true
            ? Math.min(1000, Math.max(1, Number(input.detailLimit) || 20))
            : 1000,
        preferredIds:
          input.dryRun && Array.isArray(input.preferredIds)
            ? input.preferredIds
                .filter((id) => /^[A-Z]\d{12}$/.test(id))
                .slice(0, 20)
            : [],
        categoryIndex: 0,
        detailIndex: 0,
        saveIndex: 0,
        productIds: [],
        targetIds: [],
        browserMs: 0,
        lastReportedMs: 0,
        closeStatus: "NOT_STARTED",
        rankingCount: 0,
        savedCategories: 0,
        validDetails: 0,
        blocked: 0,
        ingredients: 0,
        disclosures: 0,
        reviews: 0,
        ratings: 0,
        staticReused: 0,
      };
      if (run.dryRun && input.diagnosticOnly && run.preferredIds?.length) {
        const products: Product[] = [];
        for (const id of run.preferredIds.slice(0, run.detailLimit)) {
          const product = await this.env.DB.prepare(
            "SELECT product_name,brand_name FROM products WHERE product_id=?",
          )
            .bind(id)
            .first<{ product_name: string; brand_name: string }>();
          if (!product)
            return json({ error: "UNKNOWN_DIAGNOSTIC_PRODUCT" }, 404);
          products.push({
            id,
            name: product.product_name,
            brand: product.brand_name,
            rank: 0,
          });
        }
        run.productIds = products.map((p) => p.id);
        run.targetIds = [...run.productIds];
        run.phase = "details";
        for (const product of products)
          await this.ctx.storage.put(
            `product:${run.id}:${product.id}`,
            product,
          );
      }
      await this.ctx.storage.put({ active: run, cancelRequested: false });
      if (trigger === "cron")
        await this.ctx.storage.put(`scheduled:${rankingDate}`, run.id);
      await this.ctx.storage.setAlarm(Date.now() + 1000);
      return json({ jobId: run.id, dryRun: run.dryRun }, 202);
    });
  }

  private async browser(run: CollectionRun, code: string) {
    if (
      !run.sessionId &&
      run.unknownSessionUntil &&
      run.unknownSessionUntil > Date.now()
    )
      throw Error("UNKNOWN_SESSION_COOLDOWN");
    const ledger = await this.ledger(run.period);
    if (!canReserve(ledger.usedMs, run.browserMs, RUN_BROWSER_LIMIT_MS))
      throw Error("BROWSER_BUDGET_EXHAUSTED");
    // Reserve worst-case browser time before every remote call, including failed/ambiguous calls.
    ledger.usedMs += STEP_RESERVATION_MS;
    run.browserMs += STEP_RESERVATION_MS;
    if (!run.sessionId)
      run.unknownSessionUntil = Date.now() + STEP_RESERVATION_MS;
    await this.ctx.storage.put({
      [`budget:${run.period}`]: ledger,
      active: run,
    });
    let response: Response;
    try {
      response = await this.env.BROWSER.script(code, {
        library: "playwright",
        timeout: 45000,
        ...(run.sessionId
          ? { sessionId: run.sessionId, targetId: run.targetId }
          : { keepAlive: 60000 }),
      });
    } catch (error) {
      if (!run.sessionId)
        run.unknownSessionUntil = Date.now() + STEP_RESERVATION_MS;
      throw error;
    }
    run.sessionId =
      response.headers.get("cf-browser-session-id") || run.sessionId;
    run.targetId = response.headers.get("cf-browser-target-id") || run.targetId;
    if (run.sessionId) {
      run.closeStatus = "OPEN";
      delete run.unknownSessionUntil;
    } else {
      run.unknownSessionUntil = Date.now() + STEP_RESERVATION_MS;
      throw Error("MISSING_BROWSER_SESSION");
    }
    const rawMs = response.headers.get("x-browser-ms-used");
    const ms = rawMs === null ? NaN : Number(rawMs);
    if (Number.isFinite(ms) && ms >= run.lastReportedMs) {
      const delta = ms - run.lastReportedMs;
      ledger.usedMs += delta - STEP_RESERVATION_MS;
      run.browserMs += delta - STEP_RESERVATION_MS;
      run.lastReportedMs = ms;
    } else
      run.uncertainBrowserMs =
        (run.uncertainBrowserMs || 0) + STEP_RESERVATION_MS;
    await this.ctx.storage.put({
      [`budget:${run.period}`]: ledger,
      active: run,
    });
    const data = (await response.json()) as {
      success: boolean;
      result: unknown;
      errors?: unknown;
    };
    if (!response.ok || !data.success)
      throw Error(`BROWSER_API_${response.status}`);
    return data.result;
  }

  private async close(run: CollectionRun) {
    if (!run.sessionId) {
      if (run.unknownSessionUntil && run.unknownSessionUntil > Date.now()) {
        run.closeStatus = "AWAITING_IDLE_TIMEOUT";
        throw Error("UNKNOWN_SESSION_COOLDOWN");
      }
      if (run.unknownSessionUntil) run.closeStatus = "IDLE_TIMEOUT_ELAPSED";
      return;
    }
    try {
      const state = (await this.env.BROWSER.closeSession(run.sessionId)) as
        | string
        | {
            status?: string;
          };
      if (
        (typeof state === "string" ? state : state?.status) === "closing" &&
        (await this.isSessionOpen(run.sessionId))
      )
        throw Error("STILL_CLOSING");
      run.closeStatus = "CLOSED";
      delete run.sessionId;
      delete run.targetId;
    } catch {
      if (!run.sessionId || !(await this.isSessionOpen(run.sessionId))) {
        run.closeStatus = "CLOSED";
        delete run.sessionId;
        delete run.targetId;
        return;
      }
      // A session already closed by its idle timeout no longer consumes browser time.
      run.closeStatus = "CLOSE_RETRY_REQUIRED";
      throw Error("BROWSER_CLOSE_FAILED");
    } finally {
      await this.ctx.storage.put("active", run);
    }
  }

  private async isSessionOpen(id: string) {
    let session;
    try {
      session = (await this.env.BROWSER.getSession(id)) as {
        endTime?: number;
      } | null;
    } catch (error) {
      if (/404|session.*not.found|session.*does.not.exist/i.test(String(error)))
        return false;
      throw error;
    }
    return !!session && !session.endTime;
  }

  async alarm() {
    if (this.stepping) return;
    this.stepping = true;
    const run = await this.ctx.storage.get<CollectionRun>("active");
    if (!run) {
      this.stepping = false;
      return;
    }
    try {
      if (run.status !== "RUNNING") {
        await this.finish(run);
        return;
      }
      if (await this.ctx.storage.get("cancelRequested")) {
        run.status = "CANCELLED";
        run.stopReason = "USER_CANCELLED";
        await this.finish(run);
        return;
      }
      if (run.phase === "rankings") await this.rankings(run);
      else if (run.phase === "details") await this.details(run);
      else await this.persistCategory(run);
    } catch (error) {
      run.error = error instanceof Error ? error.message : String(error);
      run.stopReason ||= run.error;
      run.status = "FAILED";
      await this.finish(run);
      return;
    } finally {
      this.stepping = false;
    }
    if (run.status === "RUNNING") {
      await this.ctx.storage.put("active", run);
      await this.ctx.storage.setAlarm(
        Date.now() + (run.closeStatus === "CLOSE_RETRY_REQUIRED" ? 11000 : 1),
      );
    }
  }

  private async rankings(run: CollectionRun) {
    const category = codes[run.categoryIndex];
    const info = categories[category];
    const result = (await this.browser(run, rankingScript(info))) as {
      blocked: boolean;
      rows: Product[];
      selected: { id: string; text: string }[];
    };
    if (result.blocked) throw Error("RANKING_ACCESS_LIMIT");
    const valid =
      result.rows.length === 100 &&
      new Set(result.rows.map((r) => r.id)).size === 100 &&
      new Set(result.rows.map((r) => r.rank)).size === 100 &&
      result.rows.every(
        (r) => r.id && r.name && r.rank >= 1 && r.rank <= 100,
      ) &&
      result.selected.some(
        (s) => s.id === info.tab_id && (!!info.tab_id || s.text === "전체"),
      );
    if (!valid) throw Error(`INVALID_RANKING_${category}`);
    await this.ctx.storage.put(`rank:${run.id}:${category}`, result.rows);
    for (const row of result.rows) {
      if (!run.productIds.includes(row.id)) {
        run.productIds.push(row.id);
        await this.ctx.storage.put(`product:${run.id}:${row.id}`, row);
      }
    }
    run.rankingCount += 100;
    run.categoryIndex++;
    if (run.categoryIndex === codes.length) {
      run.targetIds = [
        ...new Set([
          ...(run.preferredIds || []).filter((id) =>
            run.productIds.includes(id),
          ),
          ...run.productIds,
        ]),
      ].slice(0, run.detailLimit);
      run.phase = "details";
    }
  }

  private async details(run: CollectionRun) {
    if (run.detailIndex >= run.targetIds.length) {
      await this.endBrowserPhase(run);
      return;
    }
    const ids = run.targetIds.slice(run.detailIndex, run.detailIndex + 1);
    const products: (Product & { reuseStatic: boolean })[] = [];
    const cache = new Map<string, Cached>();
    for (const id of ids) {
      const product = await this.ctx.storage.get<Product>(
        `product:${run.id}:${id}`,
      );
      if (!product) throw Error("MISSING_PRODUCT");
      const cached = await this.ctx.storage.get<Cached>(`cache:${id}`);
      const fresh =
        !!cached &&
        cached.fields.cosmetic_disclosure !== undefined &&
        cached.fields.raw !== null &&
        Date.now() - cached.checkedAt < STATIC_TTL_MS &&
        cached.fields.disclosure_checked;
      if (fresh && cached) cache.set(id, cached);
      products.push({ ...product, reuseStatic: fresh });
    }
    const results = (await this.browser(
      run,
      detailScript(products),
    )) as Detail[];
    if (!results.length || results.some((r, i) => r.id !== ids[i]))
      throw Error("INVALID_DETAIL_RESULT");
    for (const result of results) {
      const cached = cache.get(result.id);
      if (result.fields && cached) {
        Object.assign(result.fields, cached.fields);
        run.staticReused++;
      }
      if (result.fields) {
        run.validDetails++;
        if (result.fields.ingredients) run.ingredients++;
        if (result.fields.raw) run.disclosures++;
        if (result.fields.review_count !== null) run.reviews++;
        if (result.fields.rating !== null) run.ratings++;
        if (!cached && result.fields.disclosure_checked)
          await this.ctx.storage.put(`cache:${result.id}`, {
            checkedAt: Date.now(),
            fields: {
              raw: result.fields.raw,
              ingredients: result.fields.ingredients,
              disclosure_checked: result.fields.disclosure_checked,
              cosmetic_disclosure: result.fields.cosmetic_disclosure,
            },
          } satisfies Cached);
      }
      if (
        !result.fields ||
        result.fields.review_status !== "FOUND" ||
        !result.fields.disclosure_checked
      ) {
        run.failedDetails = (run.failedDetails || 0) + 1;
        run.issues ||= [];
        if (run.issues.length < 100)
          run.issues.push({
            id: result.id,
            diagnostic: !result.fields
              ? {
                  status: result.status,
                  error: result.error,
                  ...("excerpt" in result ? { excerpt: result.excerpt } : {}),
                  ...("url" in result ? { url: result.url } : {}),
                  ...("headings" in result
                    ? { headings: result.headings }
                    : {}),
                  ...("expectedName" in result
                    ? { expectedName: result.expectedName }
                    : {}),
                }
              : undefined,
            reason: result.blocked
              ? "ACCESS_LIMIT"
              : !result.fields
                ? "INVALID_PAGE"
                : result.fields.review_status !== "FOUND"
                  ? "REVIEW_NOT_RENDERED"
                  : "DISCLOSURE_NOT_RENDERED",
          });
      }
      if (result.blocked) run.blocked++;
      await this.ctx.storage.put(`detail:${run.id}:${result.id}`, result);
      run.detailIndex++;
    }
    if (results.some((r) => r.blocked)) {
      run.stopReason = "DETAIL_ACCESS_LIMIT";
      await this.endBrowserPhase(run);
    } else if (run.detailIndex >= run.targetIds.length)
      await this.endBrowserPhase(run);
    else {
      const ledger = await this.ledger(run.period);
      if (!canReserve(ledger.usedMs, run.browserMs)) {
        run.stopReason = "BROWSER_BUDGET_EXHAUSTED";
        await this.endBrowserPhase(run);
      }
    }
  }

  private async endBrowserPhase(run: CollectionRun) {
    if (run.failedDetails && !run.stopReason)
      run.stopReason = "INCOMPLETE_DETAILS";
    // Close before database writes, not after all ten categories are uploaded.
    try {
      await this.close(run);
    } catch {
      // An asynchronous close must not turn a completed collection into an import failure.
      // The next alarm repeats only this close, with the same active lock.
      await this.ctx.storage.put("active", run);
      return;
    }
    if (run.dryRun) {
      run.status = run.stopReason ? "PARTIAL" : "COMPLETE";
      await this.finish(run);
    } else run.phase = "save";
  }

  private async importRequest(path: string, body: unknown) {
    const response = await app.request(
      `http://localhost/api/${path}`,
      {
        method: "POST",
        headers: {
          origin: "http://localhost",
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      },
      {
        DB: this.env.DB,
        ASSETS: {
          fetch: async () => new Response("", { status: 404 }),
        } as unknown as Fetcher,
        LOCAL_DEV_TOKEN: "internal-cloud-collector",
      },
    );
    const data = (await response.json()) as {
      id: string;
      already_complete?: boolean;
      error?: string;
    };
    if (!response.ok)
      throw Error(`IMPORT_${response.status}_${data.error || "ERROR"}`);
    return data;
  }

  private async persistCategory(run: CollectionRun) {
    const category = codes[run.saveIndex];
    const ranked = await this.ctx.storage.get<Product[]>(
      `rank:${run.id}:${category}`,
    );
    if (!ranked || ranked.length !== 100) throw Error("MISSING_RANKING");
    const rules = await loadKeywordRules(this.env.DB);
    let succeeded = 0,
      limited = 0;
    const rows = [];
    for (const row of ranked) {
      const detail = await this.ctx.storage.get<Detail>(
        `detail:${run.id}:${row.id}`,
      );
      const f = detail?.fields;
      if (f && f.review_status === "FOUND" && f.disclosure_checked) succeeded++;
      if (detail?.blocked) limited++;
      const raw = f?.raw?.slice(0, 10000) || null;
      const parts =
        f?.cosmetic_disclosure === false ? undefined : raw?.split("/");
      const ingredientText = f?.ingredients?.toLocaleLowerCase() || null;
      const keywords =
        ingredientText === null
          ? null
          : rules
              .filter((rule) =>
                rule.includes.some((word) =>
                  ingredientText.includes(word.toLocaleLowerCase()),
                ),
              )
              .map((rule) => rule.display);
      rows.push({
        ranking_date: run.rankingDate,
        category_code: category,
        rank: row.rank,
        product_id: row.id,
        brand_name: row.brand,
        product_name: row.name,
        product_url: `https://www.oliveyoung.co.kr/store/goods/getGoodsDetail.do?goodsNo=${encodeURIComponent(row.id)}`,
        product_category: topCategory(row.category || ""),
        review_count: f?.review_count ?? null,
        rating: f?.rating ?? null,
        manufacturer_disclosure: raw,
        manufacturer_name: parts && parts.length > 1 ? parts[0].trim() : null,
        seller_name:
          parts && parts.length > 1 ? parts.slice(1).join("/").trim() : null,
        keywords,
      });
    }
    const imported = await this.importRequest("imports", {
      ranking_date: run.rankingDate,
      category_code: category,
      collected_at: run.startedAt,
      source_ref: `cloud:${run.id}:${category}`,
      replace: true,
      source_type: "MANUAL",
      detail_summary: { total: 100, succeeded, access_limited: limited },
    });
    if (!imported.already_complete) {
      for (const chunk of chunksByBytes(rows))
        await this.importRequest(`imports/${imported.id}/chunks`, {
          rows: chunk,
        });
      await this.importRequest(`imports/${imported.id}/complete`, {
        replace: true,
      });
    }
    run.savedCategories++;
    run.saveIndex++;
    if (run.saveIndex === codes.length) {
      run.status = run.stopReason ? "PARTIAL" : "COMPLETE";
      await this.finish(run);
    }
  }

  private async finish(run: CollectionRun) {
    try {
      await this.close(run);
    } catch {
      // Retain the active lock until cleanup succeeds; never launch a second browser.
      await this.ctx.storage.put("active", run);
      await this.ctx.storage.setAlarm(Date.now() + 11000);
      return;
    }
    run.finishedAt = new Date().toISOString();
    const recoverable =
      (run.resumeCount || 0) < 2 &&
      run.status === "FAILED" &&
      run.phase === "details" &&
      /^BROWSER_API_(408|410|5\d\d)$/.test(run.error || "");
    const preserveCheckpoint =
      run.status === "FAILED" && run.phase === "details";
    if (preserveCheckpoint)
      await this.ctx.storage.put(`checkpoint:${run.id}`, run);
    const history =
      (await this.ctx.storage.get<CollectionRun[]>("history")) || [];
    const summary = {
      ...run,
      recoverable,
      uniqueProducts: run.productIds.length,
      targetCount: run.targetIds.length,
      productIds: [],
      targetIds: [],
    };
    await this.ctx.storage.put(
      "history",
      [summary, ...history.filter((r) => r.id !== run.id)].slice(0, 20),
    );
    // Keep only static cache and compact run summaries, not every transient product row.
    for (const prefix of [
      `rank:${run.id}:`,
      `product:${run.id}:`,
      `detail:${run.id}:`,
    ]) {
      if (preserveCheckpoint) continue;
      for (;;) {
        const keys = [
          ...(await this.ctx.storage.list({ prefix, limit: 100 })).keys(),
        ];
        if (!keys.length) break;
        await this.ctx.storage.delete(keys);
      }
    }
    if (!preserveCheckpoint)
      await this.ctx.storage.delete(`checkpoint:${run.id}`);
    await this.ctx.storage.delete(["active", "cancelRequested"]);
    await this.ctx.storage.deleteAlarm();
    console.log(
      JSON.stringify({ event: "cloud_collection_finished", ...summary }),
    );
  }
}
