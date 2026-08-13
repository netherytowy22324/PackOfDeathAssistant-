import { db } from "@workspace/db";
import { privateMessagesTable, verifiedUsersTable } from "@workspace/db";
import { eq, and, or, desc } from "drizzle-orm";
import { logEvent } from "./system-log.js";

export interface SendMsgResult {
  success: boolean;
  delivered?: boolean;
  error?: string;
}

/**
 * Send a private message from Discord user to a Minecraft player (or vice versa).
 * If the recipient is offline in MC, the message is stored as pending.
 */
export async function sendPrivateMessage(
  fromType: "mc" | "dc",
  fromId: string,
  fromDisplay: string,
  toId: string,
  message: string,
  onlinePlayers?: string[],
): Promise<SendMsgResult> {
  if (!message.trim()) return { success: false, error: "Wiadomość nie może być pusta." };
  if (message.length > 500) return { success: false, error: "Wiadomość jest za długa (max 500 znaków)." };

  await db.insert(privateMessagesTable).values({
    fromType,
    fromId,
    fromDisplay,
    toId,
    message: message.trim(),
    isDelivered: false,
  });

  await logEvent("info", "privmsg", `MSG ${fromType}:${fromDisplay} → ${toId}: [hidden]`);
  return { success: true, delivered: false };
}

export async function getPendingMessagesForMcNick(mcNick: string) {
  return db.select().from(privateMessagesTable)
    .where(and(
      eq(privateMessagesTable.toId, mcNick),
      eq(privateMessagesTable.isDelivered, false),
    ))
    .orderBy(privateMessagesTable.createdAt);
}

export async function getPendingMessagesForDiscordId(discordId: string) {
  return db.select().from(privateMessagesTable)
    .where(and(
      eq(privateMessagesTable.toId, discordId),
      eq(privateMessagesTable.isDelivered, false),
    ))
    .orderBy(privateMessagesTable.createdAt);
}

export async function markMessagesDelivered(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  for (const id of ids) {
    await db.update(privateMessagesTable)
      .set({ isDelivered: true, deliveredAt: new Date() })
      .where(eq(privateMessagesTable.id, id));
  }
}

export async function getAllMessages(limit = 100) {
  return db.select().from(privateMessagesTable)
    .orderBy(desc(privateMessagesTable.createdAt))
    .limit(limit);
}

export async function clearDeliveredMessages(): Promise<number> {
  const delivered = await db.select({ id: privateMessagesTable.id })
    .from(privateMessagesTable)
    .where(eq(privateMessagesTable.isDelivered, true));
  if (delivered.length === 0) return 0;
  for (const row of delivered) {
    await db.delete(privateMessagesTable).where(eq(privateMessagesTable.id, row.id));
  }
  return delivered.length;
}
