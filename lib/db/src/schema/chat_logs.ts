import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const chatLogsTable = pgTable("chat_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  source: varchar("source", { length: 2 }).notNull(), // 'mc' | 'dc'
  author: varchar("author", { length: 64 }).notNull(),
  authorId: varchar("author_id", { length: 64 }),
  message: text("message").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ChatLog = typeof chatLogsTable.$inferSelect;
