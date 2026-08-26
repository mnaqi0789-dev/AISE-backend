import prisma from "../../db/prisma";

export async function getPreferredDeliveryEmail(
  userId: string,
  fallbackEmail: string,
): Promise<string> {
  const link = await prisma.oAuthAccount.findFirst({
    where: { userId, provider: "google" },
  });
  return link?.email ?? fallbackEmail;
}
