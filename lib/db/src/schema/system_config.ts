import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const systemConfigTable = pgTable("system_config", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export type SystemConfig = typeof systemConfigTable.$inferSelect;
