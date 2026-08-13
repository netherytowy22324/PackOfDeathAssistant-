import { db } from "@workspace/db";
import { errorLogsTable, chatLogsTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

type LogLevel = "info" | "warn" | "error";

export async function logEvent(level: LogLevel, service: string, message: string, context?: string): Promise<void> {
  try {
    await db.insert(errorLogsTable).values({ level, service, message, context: context ?? null });
  } catch {
    // Don't throw on log failure
  }
}

export async function logChat(source: "mc" | "dc", author: string, message: string, authorId?: string): Promise<void> {
  try {
    await db.insert(chatLogsTable).values({ source, author, message, authorId: authorId ?? null });
  } catch {
    // Don't throw on log failure
  }
}

export async function getRecentLogs(limit = 100): Promise<typeof errorLogsTable.$inferSelect[]> {
  return db.select().from(errorLogsTable).orderBy(desc(errorLogsTable.createdAt)).limit(limit);
}

export async function getRecentChats(limit = 100): Promise<typeof chatLogsTable.$inferSelect[]> {
  return db.select().from(chatLogsTable).orderBy(desc(chatLogsTable.createdAt)).limit(limit);
}
