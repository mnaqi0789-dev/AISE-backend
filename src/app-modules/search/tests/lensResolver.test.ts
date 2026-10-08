import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../db/prisma", () => ({
  default: { lens: { findFirst: vi.fn() } },
}));

import prisma from "../../../db/prisma";
import { resolveLens } from "../lensResolver";

describe("resolveLens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the all-mode scope when no lens param is given", async () => {
    const result = await resolveLens(undefined);
    expect(result).toEqual({
      lensId: null,
      lensName: "all",
      lensMode: "all",
      domains: null,
    });
    expect(prisma.lens.findFirst).not.toHaveBeenCalled();
  });

  it("returns the all-mode scope for the literal 'all' param", async () => {
    const result = await resolveLens("all");
    expect(result.lensMode).toBe("all");
    expect(prisma.lens.findFirst).not.toHaveBeenCalled();
  });

  it("throws for 'auto' since it is not yet implemented", async () => {
    await expect(resolveLens("auto")).rejects.toThrow(/not yet implemented/);
    expect(prisma.lens.findFirst).not.toHaveBeenCalled();
  });

  it("resolves a lens by id or name and returns its domains/mode", async () => {
    (prisma.lens.findFirst as any).mockResolvedValue({
      id: "lens1",
      name: "Dev",
      mode: "predefined",
      domains: ["developer.mozilla.org"],
    });

    const result = await resolveLens("Dev");

    expect(prisma.lens.findFirst).toHaveBeenCalledWith({
      where: { OR: [{ id: "Dev" }, { name: "Dev" }] },
    });
    expect(result).toEqual({
      lensId: "lens1",
      lensName: "Dev",
      lensMode: "predefined",
      domains: ["developer.mozilla.org"],
    });
  });

  it("throws when no matching lens is found", async () => {
    (prisma.lens.findFirst as any).mockResolvedValue(null);
    await expect(resolveLens("nonexistent")).rejects.toThrow(/not found/);
  });
});
