import prisma from "../../db/prisma";

export interface ResolvedLens {
  lensId: string | null;
  lensName: string;
  lensMode: "predefined" | "custom" | "all" | "auto";
  domains: string[] | null;
}

export async function resolveLens(
  lensParam: string | undefined,
): Promise<ResolvedLens> {
  if (!lensParam || lensParam === "all") {
    return { lensId: null, lensName: "all", lensMode: "all", domains: null };
  }

  if (lensParam === "auto") {
    throw new Error(
      "Auto lens mode is not yet implemented (planned for Phase 7)",
    );
  }

  const lens = await prisma.lens.findFirst({
    where: { OR: [{ id: lensParam }, { name: lensParam }] },
  });

  if (!lens) {
    throw new Error(`Lens "${lensParam}" not found`);
  }

  return {
    lensId: lens.id,
    lensName: lens.name,
    lensMode: lens.mode as "predefined" | "custom",
    domains: lens.domains,
  };
}
