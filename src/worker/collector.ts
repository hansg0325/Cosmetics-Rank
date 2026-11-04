import { Hono } from "hono";
import { z } from "zod";
export const collector = new Hono<{ Bindings: { LOCAL_DEV_TOKEN?: string } }>();
collector.use("*", async (c, next) => {
  if (
    !["127.0.0.1", "localhost", "[::1]"].includes(
      new URL(c.req.url).hostname,
    ) ||
    !c.env.LOCAL_DEV_TOKEN
  )
    return c.json(
      {
        error: "LOCAL_ONLY",
        message:
          "Selenium 수집은 로컬 PC에서 앱을 실행할 때 사용할 수 있습니다.",
      },
      404,
    );
  await next();
});
async function callHelper(path: string, token: string, method = "GET") {
  return fetch("http://127.0.0.1:8790" + path, {
    method,
    headers: {
      Authorization: "Bearer " + token,
      ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
    },
    ...(method === "POST" ? { body: "{}" } : {}),
    signal: AbortSignal.timeout(4000),
    redirect: "manual",
  });
}
collector.post("/jobs", async (c) => {
  z.object({})
    .strict()
    .parse(await c.req.json());
  try {
    const r = await callHelper("/jobs", c.env.LOCAL_DEV_TOKEN!, "POST");
    if (!r.ok) throw Error("helper unavailable");
    return c.json(await r.json(), 202);
  } catch (error) {
    console.error(
      "collector_start_failed",
      error instanceof Error ? error.message : "connection failed",
    );
    return c.json(
      {
        error: "COLLECTOR_UNAVAILABLE",
        message:
          "로컬 수집 서비스에 연결할 수 없습니다. 실행 중인 서버를 종료하고 bash ./start-local.sh로 다시 실행하세요.",
      },
      503,
    );
  }
});
collector.get("/jobs/:id", async (c) => {
  const id = z.string().uuid().parse(c.req.param("id"));
  try {
    const r = await callHelper("/jobs/" + id, c.env.LOCAL_DEV_TOKEN!);
    if (r.status === 404)
      return c.json(
        {
          error: "JOB_NOT_FOUND",
          message:
            "수집 작업이 만료됐거나 서비스를 다시 시작했습니다. 다시 수집하세요.",
        },
        404,
      );
    if (!r.ok) throw Error("helper unavailable");
    return c.json(await r.json());
  } catch (error) {
    console.error(
      "collector_status_failed",
      error instanceof Error ? error.message : "connection failed",
    );
    return c.json(
      {
        error: "COLLECTOR_UNAVAILABLE",
        message:
          "로컬 수집 서비스가 중단됐습니다. bash ./start-local.sh로 다시 실행하세요.",
      },
      503,
    );
  }
});
