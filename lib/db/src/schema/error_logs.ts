import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const errorLogsTable = pgTable("error_logs", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  level: varchar("level", { length: 10 }).notNull(), // 'info' | 'warn' | 'error'
  service: varchar("service", { length: 32 }).notNull(),
  message: text("message").notNull(),
  context: text("context"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type ErrorLog = typeof errorLogsTable.$inferSelect;
