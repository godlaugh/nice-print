import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import type { User } from "../drizzle/schema";

// Mock db module
vi.mock("./db", () => ({
  getConversionsByUser: vi.fn().mockResolvedValue([
    { id: 1, userId: 1, filename: "test.pdf", status: "done", pageCount: 5, createdAt: new Date(), updatedAt: new Date() },
  ]),
  getConversionById: vi.fn().mockImplementation(async (id: number) => {
    if (id === 1) return { id: 1, userId: 1, filename: "test.pdf", status: "done", pageCount: 5, downloadUrl: "https://example.com/file.html", createdAt: new Date(), updatedAt: new Date() };
    return undefined;
  }),
  getSlidesByConversion: vi.fn().mockResolvedValue([
    { id: 1, conversionId: 1, pageNum: 1, htmlContent: "<p>Slide 1</p>", createdAt: new Date() },
    { id: 2, conversionId: 1, pageNum: 2, htmlContent: "<p>Slide 2</p>", createdAt: new Date() },
  ]),
  deleteConversion: vi.fn().mockResolvedValue(undefined),
}));

function createUserContext(userId = 1): TrpcContext {
  const user: User = {
    id: userId,
    openId: `user-${userId}`,
    name: "Test User",
    email: "test@example.com",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("conversions.list", () => {
  it("returns conversions for the authenticated user", async () => {
    const ctx = createUserContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.conversions.list();
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe("test.pdf");
  });
});

describe("conversions.get", () => {
  it("returns conversion with slides for valid id", async () => {
    const ctx = createUserContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.conversions.get({ id: 1 });
    expect(result.id).toBe(1);
    expect(result.slides).toHaveLength(2);
    expect(result.slides[0].pageNum).toBe(1);
  });

  it("throws NOT_FOUND for non-existent conversion", async () => {
    const ctx = createUserContext(1);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.conversions.get({ id: 999 })).rejects.toThrow("NOT_FOUND");
  });

  it("throws FORBIDDEN for another user's conversion", async () => {
    const ctx = createUserContext(2); // different user
    const caller = appRouter.createCaller(ctx);
    await expect(caller.conversions.get({ id: 1 })).rejects.toThrow("FORBIDDEN");
  });
});

describe("conversions.delete", () => {
  it("deletes conversion for the owner", async () => {
    const ctx = createUserContext(1);
    const caller = appRouter.createCaller(ctx);
    const result = await caller.conversions.delete({ id: 1 });
    expect(result.success).toBe(true);
  });

  it("throws FORBIDDEN when deleting another user's conversion", async () => {
    const ctx = createUserContext(2);
    const caller = appRouter.createCaller(ctx);
    await expect(caller.conversions.delete({ id: 1 })).rejects.toThrow("FORBIDDEN");
  });
});
