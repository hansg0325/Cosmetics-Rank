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
  VIEWER_EMAILS: "reader@example.com, second@example.com",
  DB: {} as D1Database,
  ASSETS: {} as Fetcher,
};

function request(path: string, email: string, method = "GET") {
  return app.request(
    "https://rank.example.com" + path,
    {
      method,
      headers: {
        "cf-access-jwt-assertion": "email:" + email,
        origin: "https://rank.example.com",
      },
    },
    bindings,
  );
}

describe("조회 사용자와 관리자 권한", () => {
  it("본인과 등록된 조회 사용자만 로그인한다", async () => {
    expect(
      await (await request("/api/me", "owner@example.com")).json(),
    ).toEqual({ role: "admin" });
    expect(
      await (await request("/api/me", "READER@example.com")).json(),
    ).toEqual({ role: "viewer" });
    expect((await request("/api/me", "other@example.com")).status).toBe(401);
  });

  it("조회 사용자의 관리자 API와 모든 쓰기 요청을 막는다", async () => {
    for (const path of [
      "/api/imports",
      "/api/export-rankings",
      "/api/settings/keywords",
      "/api/collector/jobs/123",
    ]) {
      expect((await request(path, "reader@example.com")).status).toBe(403);
    }
    for (const path of [
      "/api/imports",
      "/api/settings/keywords",
      "/api/collector/jobs",
    ]) {
      expect((await request(path, "reader@example.com", "POST")).status).toBe(
        403,
      );
    }
    expect((await request("/api/health", "reader@example.com")).status).toBe(
      200,
    );
    expect(
      (await request("/api/imports", "owner@example.com", "POST")).status,
    ).not.toBe(403);
  });
});
