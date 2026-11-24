import { timingSafeEqual } from "node:crypto";
import type { CollectorEnv } from "./collector";
export { CloudCollector } from "./collector";
export default {
  async fetch(request: Request, env: CollectorEnv) {
    const supplied = new TextEncoder().encode(
      request.headers.get("authorization") || "",
    );
    const expected = new TextEncoder().encode(
      `Bearer ${env.COLLECTOR_CONTROL_TOKEN}`,
    );
    if (
      !env.COLLECTOR_CONTROL_TOKEN ||
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return new Response("Forbidden", { status: 403 });
    if (
      !["/status", "/start", "/cancel", "/resume"].includes(
        new URL(request.url).pathname,
      )
    )
      return new Response("Not found", { status: 404 });
    return env.COLLECTOR.get(env.COLLECTOR.idFromName("single-browser")).fetch(
      request,
    );
  },
  async scheduled(controller: ScheduledController, env: CollectorEnv) {
    const smoke =
      controller.cron === "* * * * *" && env.SCHEDULE_SMOKE === "true";
    if (controller.cron !== "0 21 * * *" && !smoke) return;
    const result = await env.COLLECTOR.get(
      env.COLLECTOR.idFromName("single-browser"),
    ).fetch("https://collector/start", {
      method: "POST",
      body: JSON.stringify({
        trigger: "cron",
        ...(smoke
          ? {
              dryRun: true,
              detailLimit: 20,
              ...(env.SMOKE_PRODUCT_IDS
                ? { preferredIds: JSON.parse(env.SMOKE_PRODUCT_IDS) }
                : {}),
            }
          : {}),
      }),
    });
    console.log("scheduled_collection", result.status, await result.text());
  },
};
