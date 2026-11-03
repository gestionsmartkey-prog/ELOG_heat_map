import { beforeAll, describe, expect, it } from "vitest";
import {
  canSeePhone,
  createSessionToken,
  toRole,
  verifySessionToken,
} from "../../src/lib/auth";

beforeAll(() => {
  process.env.SESSION_SECRET = "test-secret-0123456789";
});

describe("roles", () => {
  it("normalises anything unknown to viewer", () => {
    expect(["admin", "sales", "viewer", "root", undefined].map(toRole)).toEqual(
      ["admin", "sales", "viewer", "viewer", "viewer"],
    );
  });
  it("shows phones to admin and sales only", () => {
    expect(canSeePhone("admin")).toBe(true);
    expect(canSeePhone("sales")).toBe(true);
    expect(canSeePhone("viewer")).toBe(false);
  });
  it("keeps the sales role through a session token", async () => {
    const t = await createSessionToken({ user: "ana@elog.com", role: "sales" });
    expect(await verifySessionToken(t)).toEqual({
      user: "ana@elog.com",
      role: "sales",
    });
  });
});
