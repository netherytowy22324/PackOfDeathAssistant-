import { db } from "@workspace/db";
import { blacklistTable } from "@workspace/db";
import { eq, or } from "drizzle-orm";

export async function addToBlacklist(
  nick: string,
  discordId: string,
  addedBy: string,
  reason?: string,
): Promise<{ success: boolean; error?: string }> {
  const existing = await db
    .select()
    .from(blacklistTable)
    .where(or(eq(blacklistTable.nick, nick), eq(blacklistTable.discordId, discordId)))
    .limit(1);

  if (existing[0]) {
    return { success: false, error: `\`${existing[0].nick}\` jest już na blackliście.` };
  }

  await db.insert(blacklistTable).values({ nick, discordId, addedBy, reason });
  return { success: true };
}

export async function removeFromBlacklist(
  nick: string,
): Promise<boolean> {
  const existing = await db
    .select()
    .from(blacklistTable)
    .where(eq(blacklistTable.nick, nick))
    .limit(1);
  if (!existing[0]) return false;
  await db.delete(blacklistTable).where(eq(blacklistTable.id, existing[0].id));
  return true;
}

export async function getBlacklist() {
  return db.select().from(blacklistTable).orderBy(blacklistTable.createdAt);
}

export async function clearBlacklist() {
  const { blacklistTable } = await import("@workspace/db");
  await db.delete(blacklistTable);
}

export async function isBlacklisted(nick: string, discordId?: string) {
  const conditions = discordId
    ? or(eq(blacklistTable.nick, nick), eq(blacklistTable.discordId, discordId))
    : eq(blacklistTable.nick, nick);
  const result = await db.select().from(blacklistTable).where(conditions).limit(1);
  return result[0] ?? null;
}
