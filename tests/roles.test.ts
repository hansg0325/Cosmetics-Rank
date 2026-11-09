import { describe, expect, it, vi } from "vitest";

vi.mock("jose", () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async (token: string) => {
    if (!token.startsWith("email:")) throw new Error("invalid token");
    return { payload: { email: token.slice(6) } };
  },
}));

import app from "../src/worker/index";

const bindings = {
  ACCESS_TEAM: "example",
  ACCESS_AUD: "audience",
  ALLOWED_EMAIL: "owner@example.com",
  DB: {} as D1Database,
  ASSETS: {} as Fetcher,
};

function request(
  path: string,
  email: string,
  method = "GET",
  body?: unknown,
  db = bindings.DB,
) {
  return app.request(
    "https://rank.example.com" + path,
    {
      method,
      headers: {
        ...(email ? { "cf-access-jwt-assertion": "email:" + email } : {}),
        origin: "https://rank.example.com",
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
    { ...bindings, DB: db },
  );
}

describe("조회 사용자와 관리자 권한", () => {
  it("방문자는 로그인 없이 조회하며 관리자만 관리자 세션에 접근한다", async () => {
    expect(
      await (await request("/api/admin/session", "owner@example.com")).json(),
    ).toEqual({ role: "admin" });
    expect(
      await (await request("/api/me", "READER@example.com")).json(),
    ).toEqual({ role: "viewer" });
    expect(await (await request("/api/me", "")).json()).toEqual({ role: "viewer" });
    expect((await request("/api/admin/session", "other@example.com")).status).toBe(403);
  });

  it("방문자는 키워드를 수정할 수 있지만 수집·관리자 요청은 거부된다", async () => {
    for (const path of [
      "/api/imports",
      "/api/admin/imports",
      "/api/admin/collector/jobs/123",
    ]) {
      expect((await request(path, "reader@example.com")).status).toBe(403);
    }
    for (const path of [
      "/api/imports",
      "/api/admin/collector/jobs",
      "/api/admin/imports/123/cancel",
    ]) {
      expect((await request(path, "reader@example.com", "POST")).status).toBe(
        403,
      );
    }
    const keywordDb = {
      prepare: () => ({ bind: () => ({ run: async () => ({}) }) }),
    } as unknown as D1Database;
    expect(
      (
        await request("/api/settings/keywords", "", "POST", [], keywordDb)
      ).status,
    ).toBe(200);
    expect((await request("/api/export-rankings", "")).status).toBe(403);
    expect((await request("/api/health", "reader@example.com")).status).toBe(
      200,
    );
    expect(
      (await request("/api/imports", "owner@example.com", "POST")).status,
    ).not.toBe(403);
  });
});
